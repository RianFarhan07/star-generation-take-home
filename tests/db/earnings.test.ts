import { describe, expect, it } from "vitest";
import { expectCode, makeUser, serviceClient } from "../helpers/clients";
import { adminClient, createClass, enrollAndPay, lesson, previousMonth } from "../helpers/fixtures";

const text = {
  p_topic: "Linear equations",
  p_activities: "Worked through exercises together",
  p_observation: "Understood the method",
  p_recommendation: "Practise word problems",
};

type Ctx = Awaited<ReturnType<typeof setup>>;

// A class whose previous-month lessons (default: one of 90 minutes) have entries and a submitted logbook.
async function setup(lessonDays: number[] = [5]) {
  const admin = await adminClient();
  const tutor = await makeUser("tutor");
  const classId = await createClass(admin, { tutorId: tutor.id });
  const month = previousMonth();
  const lessonIds: string[] = [];
  for (const day of lessonDays) {
    const id = await lesson(tutor.client, classId, month.at(day));
    const { error } = await tutor.client.rpc("upsert_logbook_entry", { p_lesson_id: id, ...text });
    expect(error).toBeNull();
    lessonIds.push(id);
  }
  const { data: books } = await tutor.client.from("logbooks").select("id").eq("class_id", classId);
  const logbookId = books![0].id as string;
  const submit = await tutor.client.rpc("submit_logbook", { p_logbook_id: logbookId });
  expect(submit.error).toBeNull();
  return { admin, tutor, classId, month, lessonIds, logbookId };
}

async function earningsOf(ctx: Pick<Ctx, "tutor">) {
  const { data } = await ctx.tutor.client.from("tutor_earnings").select("lesson_id, minutes, rate_per_hour, amount");
  return data ?? [];
}

describe("preview and approval", () => {
  it("previews tutor rate x hours: 90 minutes at Rp100,000 per hour is Rp150,000", async () => {
    const ctx = await setup();
    const { data, error } = await ctx.admin.rpc("preview_logbook_earnings", { p_logbook_id: ctx.logbookId });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ lesson_id: ctx.lessonIds[0], tutor_id: ctx.tutor.id, minutes: 90, rate_per_hour: 100000, amount: 150000 });
  });

  it("refuses to preview or approve for a tutor", async () => {
    const ctx = await setup();
    await expectCode(ctx.tutor.client.rpc("preview_logbook_earnings", { p_logbook_id: ctx.logbookId }), "NOT_ALLOWED");
    await expectCode(ctx.tutor.client.rpc("approve_logbook", { p_logbook_id: ctx.logbookId }), "NOT_ALLOWED");
  });

  it("refuses to approve a logbook that has not been submitted", async () => {
    const admin = await adminClient();
    const tutor = await makeUser("tutor");
    const classId = await createClass(admin, { tutorId: tutor.id });
    const id = await lesson(tutor.client, classId, previousMonth().at(5));
    await tutor.client.rpc("upsert_logbook_entry", { p_lesson_id: id, ...text });
    const { data: books } = await tutor.client.from("logbooks").select("id").eq("class_id", classId);
    await expectCode(admin.rpc("approve_logbook", { p_logbook_id: books![0].id }), "INVALID_STATE");
  });

  it("creates one earning per lesson, and approving again adds nothing", async () => {
    const ctx = await setup([5, 12]);
    const first = await ctx.admin.rpc("approve_logbook", { p_logbook_id: ctx.logbookId });
    expect(first.error).toBeNull();
    expect(first.data).toBe(2);
    expect((await earningsOf(ctx)).map((e) => e.amount)).toEqual([150000, 150000]);

    const second = await ctx.admin.rpc("approve_logbook", { p_logbook_id: ctx.logbookId });
    expect(second.error).toBeNull();
    expect(second.data).toBe(0);
    const earnings = await earningsOf(ctx);
    expect(earnings).toHaveLength(2);
    expect(earnings.reduce((sum, e) => sum + e.amount, 0)).toBe(300000);
  });

  it("does not double the earnings when two approvals arrive at the same moment", async () => {
    const ctx = await setup([5, 12]);
    const results = await Promise.all([
      ctx.admin.rpc("approve_logbook", { p_logbook_id: ctx.logbookId }),
      ctx.admin.rpc("approve_logbook", { p_logbook_id: ctx.logbookId }),
    ]);
    expect(results.every((r) => r.error === null)).toBe(true);
    expect((results.map((r) => r.data as number)).sort()).toEqual([0, 2]);
    expect(await earningsOf(ctx)).toHaveLength(2);
  });

  it("freezes the amount: a later rate change does not touch approved earnings", async () => {
    const ctx = await setup();
    await ctx.admin.rpc("approve_logbook", { p_logbook_id: ctx.logbookId });
    await ctx.admin.rpc("set_class_rates", { p_class_id: ctx.classId, p_student_rate: 300000, p_tutor_rate: 250000 });
    const earnings = await earningsOf(ctx);
    expect(earnings).toEqual([{ lesson_id: ctx.lessonIds[0], minutes: 90, rate_per_hour: 100000, amount: 150000 }]);
  });

  it("makes the logbook read-only after approval, even for the admin edit function", async () => {
    const ctx = await setup();
    await ctx.admin.rpc("approve_logbook", { p_logbook_id: ctx.logbookId });
    const { data: entries } = await ctx.admin.from("logbook_entries").select("id").eq("logbook_id", ctx.logbookId);
    await expectCode(ctx.admin.rpc("admin_edit_entry", { p_entry_id: entries![0].id, ...text }), "INVALID_STATE");
    const book = await ctx.admin.from("logbooks").select("status, approved_by").eq("id", ctx.logbookId).single();
    expect(book.data).toMatchObject({ status: "approved" });
    expect(book.data!.approved_by).not.toBeNull();
  });
});

describe("rates by lesson date", () => {
  it("pays each lesson at the tutor rate in force when it started", async () => {
    const ctx = await setup([5, 12]);
    // From the 8th of that month the tutor rate is Rp80,000 (history row backdated with the service role).
    const history = await serviceClient().from("class_rates").insert({
      class_id: ctx.classId, effective_from: ctx.month.at(8).toISOString(), student_rate_per_hour: 150000, tutor_rate_per_hour: 80000,
    });
    expect(history.error).toBeNull();
    const { data } = await ctx.admin.rpc("preview_logbook_earnings", { p_logbook_id: ctx.logbookId });
    const byLesson = Object.fromEntries((data as { lesson_id: string; amount: number }[]).map((r) => [r.lesson_id, r.amount]));
    expect(byLesson[ctx.lessonIds[0]]).toBe(150000); // before the change
    expect(byLesson[ctx.lessonIds[1]]).toBe(120000); // after: 1.5 h x Rp80,000
    await ctx.admin.rpc("approve_logbook", { p_logbook_id: ctx.logbookId });
    expect((await earningsOf(ctx)).map((e) => e.amount).sort()).toEqual([120000, 150000]);
  });
});

describe("who can see earnings and approved logbooks", () => {
  it("keeps earnings to the admin and the tutor who earned them", async () => {
    const ctx = await setup();
    await ctx.admin.rpc("approve_logbook", { p_logbook_id: ctx.logbookId });
    const other = await makeUser("tutor");
    const student = await makeUser("student");
    expect((await other.client.from("tutor_earnings").select()).data).toEqual([]);
    expect((await student.client.from("tutor_earnings").select()).data).toEqual([]);
    expect((await ctx.admin.from("tutor_earnings").select().eq("tutor_id", ctx.tutor.id)).data).toHaveLength(1);
  });

  it("opens the approved logbook to a paid student, but not to an unpaid one", async () => {
    const ctx = await setup();
    const paid = await makeUser("student");
    await enrollAndPay(paid.client, ctx.admin, ctx.classId);
    const unpaid = await makeUser("student");
    await unpaid.client.rpc("enroll_in_class", { p_class_id: ctx.classId, p_accept_terms: true }).then(() => undefined);

    expect((await paid.client.from("logbooks").select().eq("class_id", ctx.classId)).data).toEqual([]);
    await ctx.admin.rpc("approve_logbook", { p_logbook_id: ctx.logbookId });
    expect((await paid.client.from("logbooks").select().eq("class_id", ctx.classId)).data).toHaveLength(1);
    expect((await paid.client.from("logbook_entries").select().eq("logbook_id", ctx.logbookId)).data).toHaveLength(1);
    expect((await unpaid.client.from("logbooks").select().eq("class_id", ctx.classId)).data).toEqual([]);
  });
});
