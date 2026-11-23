import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { expectCode, makeUser, serviceClient } from "../helpers/clients";
import {
  adminClient, backdateActivation, createClass, daysFromNow, enroll, enrollAndPay, lesson, previousMonth, reportPayment,
} from "../helpers/fixtures";

const text = {
  p_topic: "Linear equations",
  p_activities: "Worked through exercises together",
  p_observation: "Understood the method",
  p_recommendation: "Practise word problems",
};

// A class with two paid students and two ended 90-minute lessons in the previous month.
async function taughtClass(o: { approve: boolean }) {
  const admin = await adminClient();
  const tutor = await makeUser("tutor");
  const classId = await createClass(admin, { tutorId: tutor.id });
  const month = previousMonth();
  const students = [];
  for (let i = 0; i < 2; i++) {
    const student = await makeUser("student");
    const { enrollmentId } = await enrollAndPay(student.client, admin, classId);
    await backdateActivation(enrollmentId, month.at(1));
    students.push({ ...student, enrollmentId });
  }
  const lessons = [await lesson(tutor.client, classId, month.at(5)), await lesson(tutor.client, classId, month.at(12))];
  for (const id of lessons) await tutor.client.rpc("upsert_logbook_entry", { p_lesson_id: id, ...text });
  const { data: books } = await tutor.client.from("logbooks").select("id").eq("class_id", classId);
  const logbookId = books![0].id as string;
  await tutor.client.rpc("submit_logbook", { p_logbook_id: logbookId });
  if (o.approve) await admin.rpc("approve_logbook", { p_logbook_id: logbookId });
  return { admin, tutor, classId, students, lessons, logbookId, month };
}

describe("class profitability (I2)", () => {
  it("counts revenue from hours actually used, separately from cash and unearned hours", async () => {
    const ctx = await taughtClass({ approve: true });
    const { data, error } = await ctx.admin.rpc("class_profitability", { p_class_id: ctx.classId });
    expect(error).toBeNull();
    expect(data).toMatchObject({
      earned_revenue: 900000, // 2 students x 3 h x Rp150,000
      tutor_cost_approved: 300000, // 2 lessons x Rp150,000
      tutor_cost_estimated: 0,
      margin: 600000,
      margin_pct: 66.7,
      cash_in: 3600000, // 2 x Rp1,800,000 paid
      refunds_paid: 0,
      refunds_pending: 0,
      unearned_value: 2700000, // 2 x 9 h x Rp150,000 not yet delivered
      active_students: 2,
      student_rate: 150000,
      tutor_rate: 100000,
      margin_per_hour_now: 200000, // 2 x 150,000 - 100,000
      break_even_students: 1,
      rate_warning: false,
    });
  });

  it("estimates the cost of lessons that were taught but not approved yet", async () => {
    const ctx = await taughtClass({ approve: false });
    const { data } = await ctx.admin.rpc("class_profitability", { p_class_id: ctx.classId });
    expect(data).toMatchObject({ tutor_cost_approved: 0, tutor_cost_estimated: 300000, earned_revenue: 900000, margin: 600000 });
  });

  it("warns when one paying student cannot cover the tutor, and gives the break-even head count", async () => {
    const admin = await adminClient();
    const tutor = await makeUser("tutor");
    const classId = await createClass(admin, { tutorId: tutor.id, studentRate: 40000, tutorRate: 100000 });
    const { data } = await admin.rpc("class_profitability", { p_class_id: classId });
    expect(data).toMatchObject({ rate_warning: true, break_even_students: 3, active_students: 0, margin_per_hour_now: -100000, margin_pct: null });
  });

  it("shows pending and paid refunds, and is for admins only", async () => {
    const ctx = await taughtClass({ approve: true });
    const { data: refundId } = await ctx.admin.rpc("create_exception_refund", {
      p_enrollment_id: ctx.students[0].enrollmentId, p_amount: 200000, p_reason: "goodwill",
    });
    let { data } = await ctx.admin.rpc("class_profitability", { p_class_id: ctx.classId });
    expect(data).toMatchObject({ refunds_pending: 200000, refunds_paid: 0 });
    await ctx.admin.rpc("mark_refunded", { p_refund_id: refundId, p_bank_reference: "TRX-1" });
    ({ data } = await ctx.admin.rpc("class_profitability", { p_class_id: ctx.classId }));
    expect(data).toMatchObject({ refunds_pending: 0, refunds_paid: 200000 });
    await expectCode(ctx.tutor.client.rpc("class_profitability", { p_class_id: ctx.classId }), "NOT_ALLOWED");
    await expectCode(ctx.students[0].client.rpc("class_profitability", { p_class_id: ctx.classId }), "NOT_ALLOWED");
  });
});

describe("admin overview (I1)", () => {
  it("lists an old transfer report as overdue and counts it", async () => {
    const admin = await adminClient();
    const tutor = await makeUser("tutor");
    const classId = await createClass(admin, { tutorId: tutor.id });
    const name = `Overdue ${randomUUID().slice(0, 8)}`;
    const student = await makeUser("student", name);
    const { invoiceId } = await enroll(student.client, classId);
    const paymentId = await reportPayment(student.client, invoiceId);
    const old = new Date(Date.now() - 30 * 3600_000).toISOString();
    await serviceClient().from("payments").update({ reported_at: old }).eq("id", paymentId);

    const { data, error } = await admin.rpc("admin_overview");
    expect(error).toBeNull();
    const item = data.attention.find((a: { who: string; kind: string }) => a.who === name && a.kind === "verify_payment");
    expect(item).toMatchObject({ id: paymentId, overdue: true, status: "awaiting_verification" });
    expect(item.detail).toContain("Rp1,800,000");
    expect(data.stats.to_verify_overdue).toBeGreaterThanOrEqual(1);
    expect(data.stats.to_verify).toBeGreaterThanOrEqual(data.stats.to_verify_overdue);
    expect(data.stats.outstanding).toBeGreaterThanOrEqual(1800000);
  });

  it("shows hours per student with the Low flag, an unpaid renewal and seats per class", async () => {
    const admin = await adminClient();
    const tutor = await makeUser("tutor");
    const classId = await createClass(admin, { tutorId: tutor.id, packageHours: 2 });
    const name = `Low ${randomUUID().slice(0, 8)}`;
    const student = await makeUser("student", name);
    const { enrollmentId } = await enrollAndPay(student.client, admin, classId);
    await student.client.rpc("issue_renewal_invoice", { p_enrollment_id: enrollmentId });

    const { data } = await admin.rpc("admin_overview");
    const balance = data.balances.find((b: { enrollment_id: string }) => b.enrollment_id === enrollmentId);
    expect(balance).toMatchObject({ student_name: name, purchased_minutes: 120, used_minutes: 0, remaining_minutes: 120, low_hours: true });
    expect(data.attention.some((a: { who: string; kind: string }) => a.who === name && a.kind === "renewal_unpaid")).toBe(true);
    const seats = data.classes.find((c: { class_id: string }) => c.class_id === classId);
    expect(seats).toMatchObject({ seats_taken: 1, capacity: 2 });
    expect(data.stats.low_hours).toBeGreaterThanOrEqual(1);
  });

  it("lists a submitted logbook and a pending refund, and refuses everyone but the admin", async () => {
    const ctx = await taughtClass({ approve: false });
    await ctx.admin.rpc("create_exception_refund", { p_enrollment_id: ctx.students[0].enrollmentId, p_amount: 100000, p_reason: "goodwill" });
    const { data } = await ctx.admin.rpc("admin_overview");
    expect(data.attention.some((a: { kind: string; id: string }) => a.kind === "review_logbook" && a.id === ctx.logbookId)).toBe(true);
    expect(data.attention.some((a: { kind: string }) => a.kind === "refund_pending")).toBe(true);
    expect(data.stats.pending_refunds).toBeGreaterThanOrEqual(1);
    expect(data.stats.pending_refunds_total).toBeGreaterThanOrEqual(100000);
    await expectCode(ctx.tutor.client.rpc("admin_overview"), "NOT_ALLOWED");
    await expectCode(ctx.students[0].client.rpc("admin_overview"), "NOT_ALLOWED");
  });
});

describe("tutor earnings statement (I3)", () => {
  it("shows taught lessons as an estimate, then approved amounts, with the same numbers as the admin preview", async () => {
    const ctx = await taughtClass({ approve: false });
    const future = await lesson(ctx.tutor.client, ctx.classId, daysFromNow(4));
    const cancelled = await lesson(ctx.tutor.client, ctx.classId, daysFromNow(5));
    await ctx.tutor.client.rpc("cancel_lesson", { p_lesson_id: cancelled, p_reason: "holiday" });

    const before = await ctx.tutor.client.rpc("tutor_earnings_statement");
    expect(before.error).toBeNull();
    const rows = before.data as { lesson_id: string; status: string; amount: number; has_entry: boolean }[];
    expect(rows.map((r) => r.lesson_id)).not.toContain(cancelled);
    const byLesson = Object.fromEntries(rows.map((r) => [r.lesson_id, r]));
    expect(byLesson[ctx.lessons[0]]).toMatchObject({ status: "submitted", amount: 150000, has_entry: true });
    expect(byLesson[future]).toMatchObject({ status: "scheduled", has_entry: false });

    const preview = await ctx.admin.rpc("preview_logbook_earnings", { p_logbook_id: ctx.logbookId });
    for (const p of preview.data as { lesson_id: string; amount: number }[]) expect(byLesson[p.lesson_id].amount).toBe(p.amount);

    await ctx.admin.rpc("approve_logbook", { p_logbook_id: ctx.logbookId });
    const after = await ctx.tutor.client.rpc("tutor_earnings_statement");
    const approved = (after.data as { status: string; amount: number }[]).filter((r) => r.status === "approved");
    expect(approved.map((r) => r.amount)).toEqual([150000, 150000]);
  });

  it("marks ended lessons without an entry as taught and filters by WIB month", async () => {
    const admin = await adminClient();
    const tutor = await makeUser("tutor");
    const classId = await createClass(admin, { tutorId: tutor.id });
    const month = previousMonth();
    const id = await lesson(tutor.client, classId, month.at(5));
    const { data } = await tutor.client.rpc("tutor_earnings_statement", { p_month: month.firstDay });
    expect(data).toEqual([expect.objectContaining({ lesson_id: id, status: "taught", has_entry: false, amount: 150000 })]);
    const other = await tutor.client.rpc("tutor_earnings_statement", { p_month: "2000-01-01" });
    expect(other.data).toEqual([]);
  });

  it("only shows a tutor their own lessons, and nothing to anyone else", async () => {
    const ctx = await taughtClass({ approve: true });
    const stranger = await makeUser("tutor");
    expect((await stranger.client.rpc("tutor_earnings_statement")).data).toEqual([]);
    await expectCode(ctx.students[0].client.rpc("tutor_earnings_statement"), "NOT_ALLOWED");
    await expectCode(ctx.admin.rpc("tutor_earnings_statement"), "NOT_ALLOWED");
  });
});

describe("class roster", () => {
  it("gives the tutor the students and hour flags but no money", async () => {
    const ctx = await taughtClass({ approve: false });
    const { data, error } = await ctx.tutor.client.rpc("class_roster", { p_class_id: ctx.classId });
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    for (const row of data as Record<string, unknown>[]) {
      expect(Object.keys(row).sort()).toEqual(["enrollment_id", "enrollment_status", "full_name", "low_hours", "next_lesson_covered", "student_id"]);
      expect(row.enrollment_status).toBe("active");
    }
  });

  it("is for the class's tutor and the admin only", async () => {
    const ctx = await taughtClass({ approve: false });
    const other = await makeUser("tutor");
    await expectCode(other.client.rpc("class_roster", { p_class_id: ctx.classId }), "NOT_ALLOWED");
    await expectCode(ctx.students[0].client.rpc("class_roster", { p_class_id: ctx.classId }), "NOT_ALLOWED");
    expect((await ctx.admin.rpc("class_roster", { p_class_id: ctx.classId })).data).toHaveLength(2);
  });
});
