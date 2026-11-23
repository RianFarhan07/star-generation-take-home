import { describe, expect, it } from "vitest";
import { expectCode, makeUser } from "../helpers/clients";
import {
  adminClient, backdateActivation, createClass, daysFromNow, enroll, enrollAndPay, lesson, reportPayment,
} from "../helpers/fixtures";

async function setup(o: { packageHours?: number } = {}) {
  const admin = await adminClient();
  const tutor = await makeUser("tutor");
  const classId = await createClass(admin, { tutorId: tutor.id, packageHours: o.packageHours });
  const student = await makeUser("student");
  const paid = await enrollAndPay(student.client, admin, classId);
  return { admin, tutor, classId, student, ...paid };
}

async function balance(client: Awaited<ReturnType<typeof makeUser>>["client"], enrollmentId: string, now: Date) {
  const { data, error } = await client.rpc("enrollment_balance", { p_enrollment_id: enrollmentId, p_now: now.toISOString() });
  expect(error).toBeNull();
  return (data as Record<string, unknown>[])[0];
}

describe("hours are replayed from payments and lessons (no stored balance)", () => {
  it("deducts every ended lesson from a 12 h package: 2 x 90 min leaves 9 h worth Rp1,350,000", async () => {
    const { tutor, student, enrollmentId, classId } = await setup();
    await lesson(tutor.client, classId, daysFromNow(1));
    await lesson(tutor.client, classId, daysFromNow(2));
    const b = await balance(student.client, enrollmentId, daysFromNow(3));
    expect(b).toMatchObject({ purchased_minutes: 720, used_minutes: 180, remaining_minutes: 540, remaining_value: 1350000, low_hours: false });
  });

  it("does not deduct a lesson that has not ended yet", async () => {
    const { tutor, student, enrollmentId, classId } = await setup();
    await lesson(tutor.client, classId, daysFromNow(1));
    const b = await balance(student.client, enrollmentId, new Date());
    expect(b).toMatchObject({ used_minutes: 0, remaining_minutes: 720 });
  });

  it("never lets the balance go negative: a lesson the remaining hours cannot cover is out of hours", async () => {
    const { tutor, student, enrollmentId, classId } = await setup({ packageHours: 2 });
    const first = await lesson(tutor.client, classId, daysFromNow(1));
    const second = await lesson(tutor.client, classId, daysFromNow(2));
    await lesson(tutor.client, classId, daysFromNow(4));
    const now = daysFromNow(3);
    const b = await balance(student.client, enrollmentId, now);
    expect(b).toMatchObject({ purchased_minutes: 120, used_minutes: 90, remaining_minutes: 30, low_hours: true });
    expect(b.next_lesson_covered).toBe(false);
    expect(b.out_of_hours).toBe(true);
    const { data } = await student.client.rpc("enrollment_ledger", { p_enrollment_id: enrollmentId, p_now: now.toISOString() });
    const byLesson = Object.fromEntries((data as { lesson_id: string; status: string }[]).map((r) => [r.lesson_id, r.status]));
    expect(byLesson[first]).toBe("deducted");
    expect(byLesson[second]).toBe("out_of_hours");
  });

  it("does not deduct cancelled lessons", async () => {
    const { tutor, student, enrollmentId, classId } = await setup();
    const id = await lesson(tutor.client, classId, daysFromNow(1));
    await tutor.client.rpc("cancel_lesson", { p_lesson_id: id, p_reason: "holiday" });
    const b = await balance(student.client, enrollmentId, daysFromNow(3));
    expect(b).toMatchObject({ used_minutes: 0, remaining_minutes: 720 });
  });

  it("does not deduct lessons that started before the student's payment", async () => {
    const admin = await adminClient();
    const tutor = await makeUser("tutor");
    const classId = await createClass(admin, { tutorId: tutor.id });
    await lesson(tutor.client, classId, daysFromNow(-3));
    const student = await makeUser("student");
    const { enrollmentId } = await enrollAndPay(student.client, admin, classId);
    const b = await balance(student.client, enrollmentId, daysFromNow(1));
    expect(b).toMatchObject({ used_minutes: 0, remaining_minutes: 720 });
  });
});

describe("who may read a balance", () => {
  it("gives the tutor hours but no money, and refuses other students", async () => {
    const { tutor, student, enrollmentId, classId } = await setup();
    await lesson(tutor.client, classId, daysFromNow(1));
    const asTutor = await balance(tutor.client, enrollmentId, daysFromNow(3));
    expect(asTutor.remaining_minutes).toBe(630);
    expect(asTutor.remaining_value).toBeNull();
    const asStudent = await balance(student.client, enrollmentId, daysFromNow(3));
    expect(asStudent.remaining_value).toBe(1575000);
    const stranger = await makeUser("student");
    await expectCode(stranger.client.rpc("enrollment_balance", { p_enrollment_id: enrollmentId }), "NOT_ALLOWED");
    const otherTutor = await makeUser("tutor");
    await expectCode(otherTutor.client.rpc("enrollment_ledger", { p_enrollment_id: enrollmentId }), "NOT_ALLOWED");
  });

  it("values leftovers FIFO: hours come from the oldest invoice, so what remains of it keeps its old rate", async () => {
    const { admin, tutor, student, enrollmentId, classId } = await setup();
    await backdateActivation(enrollmentId, daysFromNow(-5));
    await lesson(tutor.client, classId, daysFromNow(-2)); // 90 min taken from the first invoice (Rp150,000/h)
    await admin.rpc("set_class_rates", { p_class_id: classId, p_student_rate: 175000, p_tutor_rate: 120000 });
    const { data: renewalId, error } = await student.client.rpc("issue_renewal_invoice", { p_enrollment_id: enrollmentId });
    expect(error).toBeNull();
    const paymentId = await reportPayment(student.client, renewalId as string);
    await admin.rpc("verify_payment", { p_payment_id: paymentId });
    const b = await balance(student.client, enrollmentId, new Date());
    // (720 - 90) min x Rp150,000/h + 720 min x Rp175,000/h
    expect(b).toMatchObject({ purchased_minutes: 1440, used_minutes: 90, remaining_minutes: 1350, remaining_value: 3675000 });
  });
});

describe("renewal invoices", () => {
  it("issues one renewal at the current rate and refuses a second while one is open", async () => {
    const { admin, student, enrollmentId, classId } = await setup();
    await admin.rpc("set_class_rates", { p_class_id: classId, p_student_rate: 160000, p_tutor_rate: 100000 });
    const { data: invoiceId, error } = await student.client.rpc("issue_renewal_invoice", { p_enrollment_id: enrollmentId });
    expect(error).toBeNull();
    const invoice = await student.client.from("invoices").select("kind, hours, rate_per_hour, amount, status").eq("id", invoiceId).single();
    expect(invoice.data).toMatchObject({ kind: "renewal", hours: 12, rate_per_hour: 160000, amount: 1920000, status: "unpaid" });
    await expectCode(student.client.rpc("issue_renewal_invoice", { p_enrollment_id: enrollmentId }), "RENEWAL_OPEN");
    await expectCode(admin.rpc("issue_renewal_invoice", { p_enrollment_id: enrollmentId }), "RENEWAL_OPEN");
  });

  it("refuses a renewal for someone else's enrollment or an enrollment that is not active", async () => {
    const { enrollmentId } = await setup();
    const stranger = await makeUser("student");
    await expectCode(stranger.client.rpc("issue_renewal_invoice", { p_enrollment_id: enrollmentId }), "NOT_ALLOWED");
    const admin = await adminClient();
    const tutor = await makeUser("tutor");
    const classId = await createClass(admin, { tutorId: tutor.id });
    const pending = await makeUser("student");
    const { enrollmentId: pendingId } = await enroll(pending.client, classId);
    await expectCode(pending.client.rpc("issue_renewal_invoice", { p_enrollment_id: pendingId }), "INVALID_STATE");
  });
});

describe("reversing a payment", () => {
  it("puts an unused first payment back to unpaid, closes access and restarts the payment window", async () => {
    const { admin, tutor, student, enrollmentId, invoiceId, classId } = await setup();
    await lesson(tutor.client, classId, daysFromNow(3));
    expect((await student.client.from("lessons").select().eq("class_id", classId)).data).toHaveLength(1);
    await expectCode(admin.rpc("reverse_payment", { p_invoice_id: invoiceId, p_reason: " " }), "VALIDATION");
    const { error } = await admin.rpc("reverse_payment", { p_invoice_id: invoiceId, p_reason: "marked the wrong student" });
    expect(error).toBeNull();
    const invoice = await student.client.from("invoices").select("status, paid_at, payment_due_at").eq("id", invoiceId).single();
    expect(invoice.data!.status).toBe("unpaid");
    expect(invoice.data!.paid_at).toBeNull();
    expect(Math.abs(Date.parse(invoice.data!.payment_due_at) - Date.now() - 24 * 3600_000)).toBeLessThan(60_000);
    const enrollment = await student.client.from("enrollments").select("status, activated_at").eq("id", enrollmentId).single();
    expect(enrollment.data).toMatchObject({ status: "pending_payment", activated_at: null });
    expect((await student.client.from("lessons").select().eq("class_id", classId)).data).toEqual([]);
    const payments = await admin.from("payments").select("status, reversal_reason").eq("invoice_id", invoiceId);
    expect(payments.data![0]).toMatchObject({ status: "reversed", reversal_reason: "marked the wrong student" });
  });

  it("refuses once any hour of that invoice has been used", async () => {
    const { admin, tutor, enrollmentId, invoiceId, classId } = await setup();
    await backdateActivation(enrollmentId, daysFromNow(-5));
    await lesson(tutor.client, classId, daysFromNow(-2));
    await expectCode(admin.rpc("reverse_payment", { p_invoice_id: invoiceId, p_reason: "transfer bounced" }), "HOURS_ALREADY_USED");
  });

  it("allows reversing a paid renewal whose hours are untouched while access stays open", async () => {
    const { admin, tutor, student, enrollmentId, classId } = await setup();
    await backdateActivation(enrollmentId, daysFromNow(-5));
    await lesson(tutor.client, classId, daysFromNow(-2));
    const { data: renewalId } = await student.client.rpc("issue_renewal_invoice", { p_enrollment_id: enrollmentId });
    await admin.rpc("verify_payment", { p_payment_id: await reportPayment(student.client, renewalId as string) });
    const { error } = await admin.rpc("reverse_payment", { p_invoice_id: renewalId, p_reason: "wrong invoice" });
    expect(error).toBeNull();
    const enrollment = await student.client.from("enrollments").select("status").eq("id", enrollmentId).single();
    expect(enrollment.data!.status).toBe("active");
    const invoice = await student.client.from("invoices").select("status").eq("id", renewalId).single();
    expect(invoice.data!.status).toBe("unpaid");
  });

  it("is for admins only and only for paid invoices", async () => {
    const { student, invoiceId } = await setup();
    await expectCode(student.client.rpc("reverse_payment", { p_invoice_id: invoiceId, p_reason: "please" }), "NOT_ALLOWED");
    const admin = await adminClient();
    const other = await makeUser("student");
    const tutor = await makeUser("tutor");
    const classId = await createClass(admin, { tutorId: tutor.id });
    const { invoiceId: unpaidId } = await enroll(other.client, classId);
    await expectCode(admin.rpc("reverse_payment", { p_invoice_id: unpaidId, p_reason: "nothing to reverse" }), "INVALID_STATE");
  });
});

describe("adjusting the hours of an unpaid invoice", () => {
  it("recomputes the amount at the invoice's own rate", async () => {
    const admin = await adminClient();
    const tutor = await makeUser("tutor");
    const classId = await createClass(admin, { tutorId: tutor.id });
    const student = await makeUser("student");
    const { invoiceId } = await enroll(student.client, classId);
    await expectCode(admin.rpc("adjust_invoice_hours", { p_invoice_id: invoiceId, p_hours: 0, p_reason: "x" }), "VALIDATION");
    await expectCode(admin.rpc("adjust_invoice_hours", { p_invoice_id: invoiceId, p_hours: 6, p_reason: " " }), "VALIDATION");
    await expectCode(student.client.rpc("adjust_invoice_hours", { p_invoice_id: invoiceId, p_hours: 1, p_reason: "cheaper" }), "NOT_ALLOWED");
    const { error } = await admin.rpc("adjust_invoice_hours", { p_invoice_id: invoiceId, p_hours: 6, p_reason: "joins mid-term" });
    expect(error).toBeNull();
    const invoice = await student.client.from("invoices").select("hours, rate_per_hour, amount").eq("id", invoiceId).single();
    expect(invoice.data).toMatchObject({ hours: 6, rate_per_hour: 150000, amount: 900000 });
  });

  it("refuses once the invoice is paid", async () => {
    const { admin, invoiceId } = await setup();
    await expectCode(admin.rpc("adjust_invoice_hours", { p_invoice_id: invoiceId, p_hours: 6, p_reason: "late change" }), "INVALID_STATE");
  });
});
