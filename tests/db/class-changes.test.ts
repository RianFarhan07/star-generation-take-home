import { describe, expect, it } from "vitest";
import { expectCode, makeUser } from "../helpers/clients";
import { adminClient, createClass, daysFromNow, lesson, previousMonth } from "../helpers/fixtures";

const text = {
  p_topic: "Fractions",
  p_activities: "Worked through exercises together",
  p_observation: "Understood the method",
  p_recommendation: "Practise word problems",
};

describe("changing the tutor of a class", () => {
  it("moves only the lessons that have not started; past lessons stay with the old tutor", async () => {
    const admin = await adminClient();
    const oldTutor = await makeUser("tutor");
    const newTutor = await makeUser("tutor");
    const classId = await createClass(admin, { tutorId: oldTutor.id });
    const past = await lesson(oldTutor.client, classId, previousMonth().at(5));
    const future = await lesson(oldTutor.client, classId, daysFromNow(5));

    const { data, error } = await admin.rpc("change_class_tutor", { p_class_id: classId, p_new_tutor_id: newTutor.id });
    expect(error).toBeNull();
    expect(data).toBe(1);

    const lessons = await admin.from("lessons").select("id, tutor_id").in("id", [past, future]);
    const tutorOf = Object.fromEntries(lessons.data!.map((l) => [l.id, l.tutor_id]));
    expect(tutorOf[past]).toBe(oldTutor.id);
    expect(tutorOf[future]).toBe(newTutor.id);
    const cls = await admin.from("classes").select("tutor_id").eq("id", classId).single();
    expect(cls.data!.tutor_id).toBe(newTutor.id);
  });

  it("changes nothing at all when a moved lesson would overlap the new tutor's own lesson", async () => {
    const admin = await adminClient();
    const oldTutor = await makeUser("tutor");
    const newTutor = await makeUser("tutor");
    const classId = await createClass(admin, { tutorId: oldTutor.id });
    const otherClass = await createClass(admin, { tutorId: newTutor.id });
    const slot = daysFromNow(6);
    const future = await lesson(oldTutor.client, classId, slot);
    await lesson(newTutor.client, otherClass, slot);

    await expectCode(admin.rpc("change_class_tutor", { p_class_id: classId, p_new_tutor_id: newTutor.id }), "LESSON_OVERLAP");
    const cls = await admin.from("classes").select("tutor_id").eq("id", classId).single();
    expect(cls.data!.tutor_id).toBe(oldTutor.id);
    const moved = await admin.from("lessons").select("tutor_id").eq("id", future).single();
    expect(moved.data!.tutor_id).toBe(oldTutor.id);
  });

  it("lets the old tutor keep reading what they taught and earned", async () => {
    const admin = await adminClient();
    const oldTutor = await makeUser("tutor");
    const newTutor = await makeUser("tutor");
    const classId = await createClass(admin, { tutorId: oldTutor.id });
    const id = await lesson(oldTutor.client, classId, previousMonth().at(5));
    await oldTutor.client.rpc("upsert_logbook_entry", { p_lesson_id: id, ...text });
    const { data: books } = await oldTutor.client.from("logbooks").select("id").eq("class_id", classId);
    await oldTutor.client.rpc("submit_logbook", { p_logbook_id: books![0].id });
    await admin.rpc("approve_logbook", { p_logbook_id: books![0].id });

    await admin.rpc("change_class_tutor", { p_class_id: classId, p_new_tutor_id: newTutor.id });

    expect((await oldTutor.client.from("tutor_earnings").select("amount")).data).toEqual([{ amount: 150000 }]);
    expect((await oldTutor.client.from("logbooks").select().eq("class_id", classId)).data).toHaveLength(1);
    expect((await newTutor.client.from("tutor_earnings").select()).data).toEqual([]);
    await expectCode(oldTutor.client.rpc("create_lesson", {
      p_class_id: classId, p_starts_at: daysFromNow(9).toISOString(), p_ends_at: daysFromNow(9, 17).toISOString(),
    }), "NOT_ALLOWED");
    const fresh = await newTutor.client.rpc("create_lesson", {
      p_class_id: classId, p_starts_at: daysFromNow(9).toISOString(), p_ends_at: daysFromNow(9, 17).toISOString(),
    });
    expect(fresh.error).toBeNull();
  });

  it("is for admins, needs a real tutor, and a different one", async () => {
    const admin = await adminClient();
    const tutor = await makeUser("tutor");
    const classId = await createClass(admin, { tutorId: tutor.id });
    const student = await makeUser("student");
    const other = await makeUser("tutor");
    await expectCode(tutor.client.rpc("change_class_tutor", { p_class_id: classId, p_new_tutor_id: other.id }), "NOT_ALLOWED");
    await expectCode(admin.rpc("change_class_tutor", { p_class_id: classId, p_new_tutor_id: student.id }), "VALIDATION");
    await expectCode(admin.rpc("change_class_tutor", { p_class_id: classId, p_new_tutor_id: tutor.id }), "VALIDATION");
  });
});

// A month in which the class changed hands: the old tutor taught the first lesson, the new tutor the second.
async function handoverMonth() {
  const admin = await adminClient();
  const oldTutor = await makeUser("tutor");
  const newTutor = await makeUser("tutor");
  const classId = await createClass(admin, { tutorId: oldTutor.id });
  const oldLesson = await lesson(oldTutor.client, classId, previousMonth().at(5));
  await admin.rpc("change_class_tutor", { p_class_id: classId, p_new_tutor_id: newTutor.id });
  const newLesson = await lesson(newTutor.client, classId, previousMonth().at(12));
  return { admin, oldTutor, newTutor, classId, oldLesson, newLesson };
}

describe("a logbook month in which the class changed tutor", () => {
  it("lets each tutor write the entry of their own lesson only", async () => {
    const { oldTutor, newTutor, oldLesson, newLesson } = await handoverMonth();
    expect((await oldTutor.client.rpc("upsert_logbook_entry", { p_lesson_id: oldLesson, ...text })).error).toBeNull();
    expect((await newTutor.client.rpc("upsert_logbook_entry", { p_lesson_id: newLesson, ...text })).error).toBeNull();
    await expectCode(newTutor.client.rpc("upsert_logbook_entry", { p_lesson_id: oldLesson, ...text }), "NOT_ALLOWED");
    await expectCode(oldTutor.client.rpc("upsert_logbook_entry", { p_lesson_id: newLesson, ...text }), "NOT_ALLOWED");
  });

  it("lets only the current tutor submit, and only once both tutors have written their entries", async () => {
    const { oldTutor, newTutor, classId, oldLesson, newLesson } = await handoverMonth();
    await newTutor.client.rpc("upsert_logbook_entry", { p_lesson_id: newLesson, ...text });
    const book = await newTutor.client.from("logbooks").select("id").eq("class_id", classId).single();
    await expectCode(newTutor.client.rpc("submit_logbook", { p_logbook_id: book.data!.id }), "LOGBOOK_INCOMPLETE");

    await oldTutor.client.rpc("upsert_logbook_entry", { p_lesson_id: oldLesson, ...text });
    await expectCode(oldTutor.client.rpc("submit_logbook", { p_logbook_id: book.data!.id }), "NOT_ALLOWED");
    expect((await newTutor.client.rpc("submit_logbook", { p_logbook_id: book.data!.id })).error).toBeNull();
  });

  it("lets the old tutor read the class and its logbook, but only the lessons they taught", async () => {
    const { oldTutor, newTutor, classId, oldLesson, newLesson } = await handoverMonth();
    await newTutor.client.rpc("upsert_logbook_entry", { p_lesson_id: newLesson, ...text });
    expect((await oldTutor.client.from("classes").select("id").eq("id", classId)).data).toHaveLength(1);
    expect((await oldTutor.client.from("logbooks").select("id").eq("class_id", classId)).data).toHaveLength(1);
    const seen = (await oldTutor.client.from("lessons").select("id").eq("class_id", classId)).data!.map((l) => l.id);
    expect(seen).toEqual([oldLesson]);
  });

  it("does not let the admin write an entry for a lesson somebody else taught", async () => {
    const { admin, oldLesson } = await handoverMonth();
    await expectCode(admin.rpc("upsert_logbook_entry", { p_lesson_id: oldLesson, ...text }), "NOT_ALLOWED");
  });

  it("lets the admin unblock the month by cancelling a lesson that never got an entry", async () => {
    const { admin, newTutor, classId, oldLesson, newLesson } = await handoverMonth();
    await newTutor.client.rpc("upsert_logbook_entry", { p_lesson_id: newLesson, ...text });
    const book = await newTutor.client.from("logbooks").select("id").eq("class_id", classId).single();
    await expectCode(newTutor.client.rpc("submit_logbook", { p_logbook_id: book.data!.id }), "LOGBOOK_INCOMPLETE");
    expect((await admin.rpc("cancel_lesson", { p_lesson_id: oldLesson, p_reason: "The old tutor left and no record exists" })).error).toBeNull();
    expect((await newTutor.client.rpc("submit_logbook", { p_logbook_id: book.data!.id })).error).toBeNull();
  });

  it("does not let the new tutor cancel a lesson the old tutor already taught and wrote up", async () => {
    const { oldTutor, newTutor, oldLesson } = await handoverMonth();
    await oldTutor.client.rpc("upsert_logbook_entry", { p_lesson_id: oldLesson, ...text });
    await expectCode(newTutor.client.rpc("cancel_lesson", { p_lesson_id: oldLesson, p_reason: "Not mine" }), "NOT_ALLOWED");
    const after = await newTutor.client.from("lessons").select("status").eq("id", oldLesson).single();
    expect(after.data!.status).toBe("scheduled");
    const entry = await oldTutor.client.from("logbook_entries").select("id").eq("lesson_id", oldLesson);
    expect(entry.data).toHaveLength(1);
  });

  it("does not let the new tutor move a lesson the old tutor taught", async () => {
    const { newTutor, oldLesson } = await handoverMonth();
    const start = previousMonth().at(6);
    await expectCode(
      newTutor.client.rpc("update_lesson_time", {
        p_lesson_id: oldLesson, p_starts_at: start.toISOString(), p_ends_at: new Date(start.getTime() + 90 * 60_000).toISOString(),
      }),
      "NOT_ALLOWED",
    );
  });

  it("does not let the old tutor cancel or move their own lesson once they no longer teach the class", async () => {
    const { oldTutor, oldLesson } = await handoverMonth();
    const start = previousMonth().at(6);
    await expectCode(oldTutor.client.rpc("cancel_lesson", { p_lesson_id: oldLesson, p_reason: "No longer mine" }), "NOT_ALLOWED");
    await expectCode(
      oldTutor.client.rpc("update_lesson_time", {
        p_lesson_id: oldLesson, p_starts_at: start.toISOString(), p_ends_at: new Date(start.getTime() + 90 * 60_000).toISOString(),
      }),
      "NOT_ALLOWED",
    );
  });

  it("still lets the new tutor change their own lessons and the admin change any lesson", async () => {
    const { admin, newTutor, oldLesson, newLesson } = await handoverMonth();
    const start = previousMonth().at(13);
    const later = previousMonth().at(7);
    const end = (d: Date) => new Date(d.getTime() + 90 * 60_000).toISOString();
    expect((await newTutor.client.rpc("update_lesson_time", { p_lesson_id: newLesson, p_starts_at: start.toISOString(), p_ends_at: end(start) })).error).toBeNull();
    expect((await admin.rpc("update_lesson_time", { p_lesson_id: oldLesson, p_starts_at: later.toISOString(), p_ends_at: end(later) })).error).toBeNull();
    expect((await newTutor.client.rpc("cancel_lesson", { p_lesson_id: newLesson, p_reason: "Holiday" })).error).toBeNull();
    expect((await admin.rpc("cancel_lesson", { p_lesson_id: oldLesson, p_reason: "Admin decision" })).error).toBeNull();
  });
});
