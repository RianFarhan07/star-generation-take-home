import { describe, expect, it } from "vitest";
import { expectCode, makeUser } from "../helpers/clients";
import {
  adminClient, createClass, daysFromNow, enroll, enrollAndPay, hoursFromNow, lesson, reportPayment, runJobs,
} from "../helpers/fixtures";

async function setup(o: { capacity?: number; packageHours?: number } = {}) {
  const admin = await adminClient();
  const tutor = await makeUser("tutor");
  const classId = await createClass(admin, { tutorId: tutor.id, capacity: o.capacity, packageHours: o.packageHours });
  return { admin, tutor, classId };
}

describe("payment window (24 hours)", () => {
  it("cancels an enrollment whose transfer was never reported, and frees the seat", async () => {
    const { classId } = await setup({ capacity: 1 });
    const student = await makeUser("student");
    const { enrollmentId, invoiceId } = await enroll(student.client, classId);

    expect(await runJobs(hoursFromNow(23), [enrollmentId])).toMatchObject({ expired: 0 });
    expect(await runJobs(hoursFromNow(25), [enrollmentId])).toMatchObject({ expired: 1 });

    const enrollment = await student.client.from("enrollments").select("status, end_cause").eq("id", enrollmentId).single();
    expect(enrollment.data).toMatchObject({ status: "cancelled", end_cause: "expired" });
    const invoice = await student.client.from("invoices").select("status, cancel_reason").eq("id", invoiceId).single();
    expect(invoice.data).toMatchObject({ status: "cancelled", cancel_reason: "expired" });

    const next = await makeUser("student");
    expect((await next.client.rpc("enroll_in_class", { p_class_id: classId, p_accept_terms: true })).error).toBeNull();
  });

  it("keeps the seat of a student who reported the transfer, however long the admin takes", async () => {
    const { classId } = await setup();
    const student = await makeUser("student");
    const { enrollmentId, invoiceId } = await enroll(student.client, classId);
    await reportPayment(student.client, invoiceId);
    expect(await runJobs(hoursFromNow(24 * 10), [enrollmentId])).toMatchObject({ expired: 0 });
    const enrollment = await student.client.from("enrollments").select("status").eq("id", enrollmentId).single();
    expect(enrollment.data!.status).toBe("awaiting_verification");
  });
});

describe("renewal invoices and seat release (Decision 3a)", () => {
  async function runningOut() {
    const ctx = await setup({ capacity: 1, packageHours: 4 });
    const student = await makeUser("student");
    const paid = await enrollAndPay(student.client, ctx.admin, ctx.classId);
    for (const day of [1, 2, 3]) await lesson(ctx.tutor.client, ctx.classId, daysFromNow(day));
    return { ...ctx, student, ...paid };
  }

  it("issues one renewal when 3 hours or less are left, and not twice", async () => {
    const { student, enrollmentId } = await runningOut();
    expect(await runJobs(daysFromNow(0), [enrollmentId])).toMatchObject({ renewals: 0 }); // 4 h left
    expect(await runJobs(daysFromNow(2, 23), [enrollmentId])).toMatchObject({ renewals: 1 }); // 2 lessons ended: 1 h left
    expect(await runJobs(daysFromNow(2, 23), [enrollmentId])).toMatchObject({ renewals: 0 });
    const { data } = await student.client.from("invoices").select("kind, hours, amount, status, issued_by").eq("enrollment_id", enrollmentId).eq("kind", "renewal");
    expect(data).toEqual([{ kind: "renewal", hours: 4, amount: 600000, status: "unpaid", issued_by: null }]);
  });

  it("does not renew a student who still has plenty of hours", async () => {
    const ctx = await setup();
    const student = await makeUser("student");
    const { enrollmentId } = await enrollAndPay(student.client, ctx.admin, ctx.classId);
    await lesson(ctx.tutor.client, ctx.classId, daysFromNow(1));
    expect(await runJobs(daysFromNow(3), [enrollmentId])).toMatchObject({ renewals: 0 });
  });

  it("withdraws a student 7 days after the first lesson they could not attend for lack of hours, and cancels the renewal", async () => {
    const { student, classId, enrollmentId } = await runningOut();
    expect(await runJobs(daysFromNow(4), [enrollmentId])).toMatchObject({ renewals: 1, released: 0 });
    expect(await runJobs(daysFromNow(9), [enrollmentId])).toMatchObject({ released: 0 }); // 6 days after the lesson at +3 d
    expect(await runJobs(daysFromNow(12), [enrollmentId])).toMatchObject({ released: 1 });

    const enrollment = await student.client.from("enrollments").select("status, end_cause").eq("id", enrollmentId).single();
    expect(enrollment.data).toMatchObject({ status: "withdrawn", end_cause: "not_renewed" });
    const open = await student.client.from("invoices").select("status").eq("enrollment_id", enrollmentId).eq("kind", "renewal");
    expect(open.data).toEqual([{ status: "cancelled" }]);
    expect((await student.client.from("refunds").select()).data).toEqual([]);
    const next = await makeUser("student");
    expect((await next.client.rpc("enroll_in_class", { p_class_id: classId, p_accept_terms: true })).error).toBeNull();
  });

  it("does not withdraw a student whose renewal transfer is waiting for the admin", async () => {
    const { student, enrollmentId } = await runningOut();
    await runJobs(daysFromNow(4), [enrollmentId]);
    const { data: renewal } = await student.client.from("invoices").select("id").eq("enrollment_id", enrollmentId).eq("kind", "renewal").single();
    await reportPayment(student.client, renewal!.id);
    expect(await runJobs(daysFromNow(12), [enrollmentId])).toMatchObject({ released: 0 });
    const enrollment = await student.client.from("enrollments").select("status").eq("id", enrollmentId).single();
    expect(enrollment.data!.status).toBe("active");
  });
});

describe("a transfer that arrives after the payment window (Decision 5d)", () => {
  async function expired(o: { capacity?: number } = {}) {
    const ctx = await setup(o);
    const student = await makeUser("student");
    const { enrollmentId, invoiceId } = await enroll(student.client, ctx.classId);
    await runJobs(hoursFromNow(25), [enrollmentId]);
    return { ...ctx, student, enrollmentId, invoiceId };
  }

  it("is honoured at the original price while the seat is still free", async () => {
    const { admin, classId, student, enrollmentId, invoiceId } = await expired();
    await admin.rpc("set_class_rates", { p_class_id: classId, p_student_rate: 175000, p_tutor_rate: 100000 });
    const paymentId = await reportPayment(student.client, invoiceId);
    const afterReport = await student.client.from("enrollments").select("status").eq("id", enrollmentId).single();
    expect(afterReport.data!.status).toBe("awaiting_verification");
    expect((await admin.rpc("verify_payment", { p_payment_id: paymentId })).error).toBeNull();
    const enrollment = await student.client.from("enrollments").select("status, ended_at").eq("id", enrollmentId).single();
    expect(enrollment.data).toMatchObject({ status: "active", ended_at: null });
    const invoice = await student.client.from("invoices").select("status, amount").eq("id", invoiceId).single();
    expect(invoice.data).toEqual({ status: "paid", amount: 1800000 });
  });

  it("creates a full refund when the class filled up meanwhile, and gives no access", async () => {
    const { admin, tutor, classId, student, enrollmentId, invoiceId } = await expired({ capacity: 1 });
    await lesson(tutor.client, classId, daysFromNow(3));
    const taker = await makeUser("student");
    await enroll(taker.client, classId);

    const paymentId = await reportPayment(student.client, invoiceId);
    const payment = await admin.from("payments").select("no_seat, status").eq("id", paymentId).single();
    expect(payment.data).toEqual({ no_seat: true, status: "pending" });
    expect((await student.client.from("enrollments").select("status").eq("id", enrollmentId).single()).data!.status).toBe("cancelled");

    expect((await admin.rpc("verify_payment", { p_payment_id: paymentId })).error).toBeNull();
    const refunds = await student.client.from("refunds").select("amount, cause, status").eq("enrollment_id", enrollmentId);
    expect(refunds.data).toEqual([{ amount: 1800000, cause: "late_no_seat", status: "pending" }]);
    expect((await student.client.from("lessons").select().eq("class_id", classId)).data).toEqual([]);
    expect((await taker.client.from("refunds").select()).data).toEqual([]);
  });

  it("creates no refund when the admin rejects the late payment", async () => {
    const { admin, classId, student, enrollmentId, invoiceId } = await expired({ capacity: 1 });
    await enroll((await makeUser("student")).client, classId);
    const paymentId = await reportPayment(student.client, invoiceId);
    expect((await admin.rpc("reject_payment", { p_payment_id: paymentId, p_reason: "nothing on the statement" })).error).toBeNull();
    expect((await student.client.from("invoices").select("status").eq("id", invoiceId).single()).data!.status).toBe("cancelled");
    expect((await student.client.from("refunds").select().eq("enrollment_id", enrollmentId)).data).toEqual([]);
  });

  it("is refused when the student already has a newer enrollment, or the invoice was cancelled for another reason", async () => {
    const { classId, student, invoiceId } = await expired();
    await enroll(student.client, classId);
    await expectCode(
      student.client.rpc("report_payment", { p_invoice_id: invoiceId, p_sender_name: "B", p_bank: "BCA", p_transfer_date: "2026-11-24", p_amount: 1800000 }),
      "INVALID_STATE",
    );
    const other = await makeUser("student");
    const { enrollmentId, invoiceId: cancelledInvoice } = await enroll(other.client, classId);
    await other.client.rpc("cancel_pending_enrollment", { p_enrollment_id: enrollmentId });
    await expectCode(
      other.client.rpc("report_payment", { p_invoice_id: cancelledInvoice, p_sender_name: "B", p_bank: "BCA", p_transfer_date: "2026-11-24", p_amount: 1800000 }),
      "INVALID_STATE",
    );
  });
});
