import { describe, expect, it } from "vitest";
import { expectCode, makeUser, serviceClient } from "../helpers/clients";
import { adminClient, createClass, daysFromNow, enrollAndPay, lesson, previousMonth } from "../helpers/fixtures";
import { wibInputToUtcIso } from "../../src/lib/time";

const text = (topic: string) => ({
  p_topic: topic,
  p_activities: "Worked through exercises together",
  p_observation: "Understood the method, slow on word problems",
  p_recommendation: "Practise two word problems before next lesson",
});

async function setup() {
  const admin = await adminClient();
  const tutor = await makeUser("tutor");
  const classId = await createClass(admin, { tutorId: tutor.id });
  const month = previousMonth();
  return { admin, tutor, classId, month };
}

async function entry(tutor: Awaited<ReturnType<typeof makeUser>>, lessonId: string, topic = "Linear equations") {
  const { data, error } = await tutor.client.rpc("upsert_logbook_entry", { p_lesson_id: lessonId, ...text(topic) });
  if (error) throw new Error(`upsert_logbook_entry failed: ${error.message}`);
  return data as string;
}

async function logbookOf(client: Awaited<ReturnType<typeof makeUser>>["client"], classId: string) {
  const { data } = await client.from("logbooks").select().eq("class_id", classId);
  return data ?? [];
}

describe("entries", () => {
  it("refuses an entry for a lesson that has not ended", async () => {
    const { tutor, classId } = await setup();
    const future = await lesson(tutor.client, classId, daysFromNow(3));
    await expectCode(tutor.client.rpc("upsert_logbook_entry", { p_lesson_id: future, ...text("x") }), "LESSON_NOT_ENDED");
  });

  it("requires all four fields", async () => {
    const { tutor, classId, month } = await setup();
    const id = await lesson(tutor.client, classId, month.at(5));
    for (const field of ["p_topic", "p_activities", "p_observation", "p_recommendation"]) {
      await expectCode(tutor.client.rpc("upsert_logbook_entry", { p_lesson_id: id, ...text("x"), [field]: "   " }), "VALIDATION");
    }
  });

  it("keeps one entry per lesson: writing again updates it", async () => {
    const { tutor, classId, month } = await setup();
    const id = await lesson(tutor.client, classId, month.at(5));
    const first = await entry(tutor, id, "First draft");
    const second = await entry(tutor, id, "Final topic");
    expect(second).toBe(first);
    const rows = await tutor.client.from("logbook_entries").select("topic").eq("lesson_id", id);
    expect(rows.data).toEqual([{ topic: "Final topic" }]);
  });

  it("puts two lessons of the same month into one logbook", async () => {
    const { tutor, classId, month } = await setup();
    await entry(tutor, await lesson(tutor.client, classId, month.at(5)));
    await entry(tutor, await lesson(tutor.client, classId, month.at(12)));
    const books = await logbookOf(tutor.client, classId);
    expect(books).toHaveLength(1);
    expect(books[0].month).toBe(month.firstDay);
    const entries = await tutor.client.from("logbook_entries").select().eq("logbook_id", books[0].id);
    expect(entries.data).toHaveLength(2);
  });

  it("files a lesson at 06:00 WIB on the 1st under that WIB month, not the previous UTC month", async () => {
    const { tutor, classId } = await setup();
    const startsAt = wibInputToUtcIso("2026-11-01", "06:00");
    const { data } = await tutor.client.rpc("create_lesson", {
      p_class_id: classId, p_starts_at: startsAt, p_ends_at: wibInputToUtcIso("2026-11-01", "07:30"),
    });
    await entry(tutor, data as string);
    const books = await logbookOf(tutor.client, classId);
    expect(books.map((b) => b.month)).toEqual(["2026-11-01"]);
  });

  it("refuses an entry for a cancelled lesson, and from another tutor", async () => {
    const { tutor, classId, month } = await setup();
    const cancelled = await lesson(tutor.client, classId, month.at(5));
    await tutor.client.rpc("cancel_lesson", { p_lesson_id: cancelled, p_reason: "holiday" });
    await expectCode(tutor.client.rpc("upsert_logbook_entry", { p_lesson_id: cancelled, ...text("x") }), "VALIDATION");
    const real = await lesson(tutor.client, classId, month.at(6));
    const other = await makeUser("tutor");
    await expectCode(other.client.rpc("upsert_logbook_entry", { p_lesson_id: real, ...text("x") }), "NOT_ALLOWED");
  });
});

describe("submitting", () => {
  it("refuses while an ended lesson has no entry, then locks the month once submitted", async () => {
    const { tutor, classId, month } = await setup();
    const a = await lesson(tutor.client, classId, month.at(5));
    await lesson(tutor.client, classId, month.at(12));
    await entry(tutor, a);
    const [book] = await logbookOf(tutor.client, classId);
    await expectCode(tutor.client.rpc("submit_logbook", { p_logbook_id: book.id }), "LOGBOOK_INCOMPLETE");
  });

  it("submits a complete month; afterwards entries and lessons of that month are locked", async () => {
    const { tutor, classId, month } = await setup();
    const a = await lesson(tutor.client, classId, month.at(5));
    await entry(tutor, a);
    const [book] = await logbookOf(tutor.client, classId);
    const { error } = await tutor.client.rpc("submit_logbook", { p_logbook_id: book.id });
    expect(error).toBeNull();
    const after = (await logbookOf(tutor.client, classId))[0];
    expect(after.status).toBe("submitted");
    await expectCode(tutor.client.rpc("upsert_logbook_entry", { p_lesson_id: a, ...text("late edit") }), "INVALID_STATE");
    await expectCode(
      tutor.client.rpc("create_lesson", {
        p_class_id: classId, p_starts_at: month.at(20).toISOString(), p_ends_at: month.at(20, 17).toISOString(),
      }),
      "MONTH_LOCKED",
    );
    await expectCode(tutor.client.rpc("cancel_lesson", { p_lesson_id: a, p_reason: "too late" }), "MONTH_LOCKED");
    await expectCode(tutor.client.rpc("submit_logbook", { p_logbook_id: book.id }), "INVALID_STATE");
  });

  it("is for the class's tutor only", async () => {
    const { tutor, classId, month } = await setup();
    await entry(tutor, await lesson(tutor.client, classId, month.at(5)));
    const [book] = await logbookOf(tutor.client, classId);
    const other = await makeUser("tutor");
    await expectCode(other.client.rpc("submit_logbook", { p_logbook_id: book.id }), "NOT_ALLOWED");
  });
});

describe("hidden from students until approved (through the API too)", () => {
  it("shows a paid student nothing while the logbook is a draft or submitted", async () => {
    const { admin, tutor, classId, month } = await setup();
    const student = await makeUser("student");
    await enrollAndPay(student.client, admin, classId);
    const a = await lesson(tutor.client, classId, month.at(5));
    await entry(tutor, a);
    const [book] = await logbookOf(tutor.client, classId);
    expect(await logbookOf(student.client, classId)).toEqual([]);
    expect((await student.client.from("logbook_entries").select()).data).toEqual([]);
    await tutor.client.rpc("submit_logbook", { p_logbook_id: book.id });
    expect(await logbookOf(student.client, classId)).toEqual([]);
    expect((await student.client.from("logbook_entries").select()).data).toEqual([]);
    expect((await student.client.from("logbook_reviews").select()).data).toEqual([]);
  });

  it("keeps one class's logbook away from another tutor", async () => {
    const { tutor, classId, month } = await setup();
    await entry(tutor, await lesson(tutor.client, classId, month.at(5)));
    const other = await makeUser("tutor");
    expect(await logbookOf(other.client, classId)).toEqual([]);
    expect((await other.client.from("logbook_entries").select()).data).toEqual([]);
  });
});

describe("admin review", () => {
  async function submitted() {
    const ctx = await setup();
    const a = await lesson(ctx.tutor.client, ctx.classId, ctx.month.at(5));
    const b = await lesson(ctx.tutor.client, ctx.classId, ctx.month.at(12));
    const entryA = await entry(ctx.tutor, a, "Fractions");
    const entryB = await entry(ctx.tutor, b, "Ratios");
    const [book] = await logbookOf(ctx.tutor.client, ctx.classId);
    await ctx.tutor.client.rpc("submit_logbook", { p_logbook_id: book.id });
    return { ...ctx, book, entryA, entryB };
  }

  it("lets only an admin request changes, with a comment, and then the tutor can fix and resubmit", async () => {
    const { admin, tutor, book, entryA, classId, month } = await submitted();
    await expectCode(tutor.client.rpc("request_logbook_changes", { p_logbook_id: book.id, p_comment: "nope" }), "NOT_ALLOWED");
    await expectCode(admin.rpc("request_logbook_changes", { p_logbook_id: book.id, p_comment: "  " }), "VALIDATION");
    const { error } = await admin.rpc("request_logbook_changes", {
      p_logbook_id: book.id, p_comment: "Observation is too short", p_flagged_entry_ids: [entryA],
    });
    expect(error).toBeNull();
    expect((await logbookOf(tutor.client, classId))[0].status).toBe("changes_requested");
    const reviews = await tutor.client.from("logbook_reviews").select("action, comment, entry_id").eq("logbook_id", book.id);
    expect(reviews.data!.filter((r) => r.entry_id === entryA)).toHaveLength(1);
    expect(reviews.data!.some((r) => r.action === "changes_requested" && r.entry_id === null)).toBe(true);

    const fix = await tutor.client.rpc("upsert_logbook_entry", {
      p_lesson_id: (await tutor.client.from("logbook_entries").select("lesson_id").eq("id", entryA).single()).data!.lesson_id,
      ...text("Fractions (revised)"),
    });
    expect(fix.error).toBeNull();
    const resubmit = await tutor.client.rpc("submit_logbook", { p_logbook_id: book.id });
    expect(resubmit.error).toBeNull();
    // the month unlocked while the logbook was with the tutor, and locks again now
    await expectCode(
      tutor.client.rpc("create_lesson", {
        p_class_id: classId, p_starts_at: month.at(25).toISOString(), p_ends_at: month.at(25, 17).toISOString(),
      }),
      "MONTH_LOCKED",
    );
  });

  it("refuses to flag an entry that belongs to another logbook", async () => {
    const { admin, book } = await submitted();
    const foreign = await submitted();
    await expectCode(
      admin.rpc("request_logbook_changes", { p_logbook_id: book.id, p_comment: "check", p_flagged_entry_ids: [foreign.entryA] }),
      "VALIDATION",
    );
  });

  it("lets the admin fix an entry while submitted, keeping the previous version and marking it", async () => {
    const { admin, tutor, entryA, book } = await submitted();
    const { error } = await admin.rpc("admin_edit_entry", { p_entry_id: entryA, ...text("Fractions (typo fixed)") });
    expect(error).toBeNull();
    const row = await tutor.client.from("logbook_entries").select("topic, edited_by_admin").eq("id", entryA).single();
    expect(row.data).toEqual({ topic: "Fractions (typo fixed)", edited_by_admin: true });
    const revisions = await tutor.client.from("logbook_entry_revisions").select("topic").eq("entry_id", entryA);
    expect(revisions.data).toEqual([{ topic: "Fractions" }]);
    const reviews = await admin.from("logbook_reviews").select("action").eq("logbook_id", book.id);
    expect(reviews.data!.map((r) => r.action)).toContain("admin_edited");
    await expectCode(tutor.client.rpc("admin_edit_entry", { p_entry_id: entryA, ...text("x") }), "NOT_ALLOWED");
  });

  it("refuses an admin edit unless the logbook is submitted", async () => {
    const { admin, tutor, classId, month } = await setup();
    const entryId = await entry(tutor, await lesson(tutor.client, classId, month.at(5)));
    await expectCode(admin.rpc("admin_edit_entry", { p_entry_id: entryId, ...text("x") }), "INVALID_STATE");
  });
});

describe("an approved logbook is read-only", () => {
  it("rejects every change once approved, even from the admin functions and direct writes", async () => {
    const { admin, tutor, classId, month } = await setup();
    const a = await lesson(tutor.client, classId, month.at(5));
    const entryId = await entry(tutor, a);
    const [book] = await logbookOf(tutor.client, classId);
    await tutor.client.rpc("submit_logbook", { p_logbook_id: book.id });
    const service = serviceClient();
    const approve = await service.from("logbooks").update({ status: "approved" }).eq("id", book.id);
    expect(approve.error).toBeNull();

    await expectCode(tutor.client.rpc("upsert_logbook_entry", { p_lesson_id: a, ...text("x") }), "INVALID_STATE");
    await expectCode(admin.rpc("admin_edit_entry", { p_entry_id: entryId, ...text("x") }), "INVALID_STATE");
    await expectCode(admin.rpc("request_logbook_changes", { p_logbook_id: book.id, p_comment: "x" }), "INVALID_STATE");
    const direct = await service.from("logbook_entries").update({ topic: "sneaky" }).eq("id", entryId);
    expect(direct.error?.message.startsWith("INVALID_STATE:")).toBe(true);
    const remove = await service.from("logbook_entries").delete().eq("id", entryId);
    expect(remove.error?.message.startsWith("INVALID_STATE:")).toBe(true);
    const reopen = await service.from("logbooks").update({ status: "draft" }).eq("id", book.id);
    expect(reopen.error?.message.startsWith("INVALID_STATE:")).toBe(true);
  });
});
