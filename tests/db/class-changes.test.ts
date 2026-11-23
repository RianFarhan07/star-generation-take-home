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
