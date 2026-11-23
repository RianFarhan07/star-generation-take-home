import { describe, expect, it } from "vitest";
import { expectCode, makeUser } from "../helpers/clients";
import {
  adminClient, backdateActivation, createClass, daysFromNow, enroll, enrollAndPay, lesson, reportPayment,
} from "../helpers/fixtures";

async function paidStudent(o: { capacity?: number; packageHours?: number } = {}) {
  const admin = await adminClient();
  const tutor = await makeUser("tutor");
  const classId = await createClass(admin, { tutorId: tutor.id, capacity: o.capacity, packageHours: o.packageHours });
  const student = await makeUser("student");
  const paid = await enrollAndPay(student.client, admin, classId);
  return { admin, tutor, classId, student, ...paid };
}

describe("withdrawing", () => {
  it("lets a student leave: no refund, the seat is free again and open invoices are cancelled", async () => {
    const { admin, classId, student, enrollmentId } = await paidStudent({ capacity: 1 });
    const { data: renewal } = await student.client.rpc("issue_renewal_invoice", { p_enrollment_id: enrollmentId });
    const { data, error } = await student.client.rpc("withdraw_enrollment", {
      p_enrollment_id: enrollmentId, p_cause: "student", p_reason: "moving to another city",
    });
    expect(error).toBeNull();
    expect(data).toBeNull();
    const enrollment = await student.client.from("enrollments").select("status, end_cause, end_reason").eq("id", enrollmentId).single();
    expect(enrollment.data).toMatchObject({ status: "withdrawn", end_cause: "student", end_reason: "moving to another city" });
    expect((await student.client.from("invoices").select("status").eq("id", renewal).single()).data!.status).toBe("cancelled");
    expect((await student.client.from("refunds").select()).data).toEqual([]);
    const next = await makeUser("student");
    expect((await next.client.rpc("enroll_in_class", { p_class_id: classId, p_accept_terms: true })).error).toBeNull();
    expect(admin).toBeDefined();
  });

  it("does not let a student claim a business-caused exit, or leave someone else's enrollment", async () => {
    const { student, enrollmentId } = await paidStudent();
    await expectCode(student.client.rpc("withdraw_enrollment", { p_enrollment_id: enrollmentId, p_cause: "business", p_reason: "refund me" }), "NOT_ALLOWED");
    const stranger = await makeUser("student");
    await expectCode(stranger.client.rpc("withdraw_enrollment", { p_enrollment_id: enrollmentId, p_cause: "student", p_reason: "x" }), "NOT_ALLOWED");
    await expectCode(student.client.rpc("withdraw_enrollment", { p_enrollment_id: enrollmentId, p_cause: "expired", p_reason: "x" }), "VALIDATION");
  });

  it("refuses while a transfer is waiting for verification, and for enrollments that are not active", async () => {
    const { student, enrollmentId, classId } = await paidStudent();
    const { data: renewal } = await student.client.rpc("issue_renewal_invoice", { p_enrollment_id: enrollmentId });
    await reportPayment(student.client, renewal as string);
    await expectCode(student.client.rpc("withdraw_enrollment", { p_enrollment_id: enrollmentId, p_cause: "student", p_reason: "x" }), "PAYMENT_PENDING");
    const pending = await makeUser("student");
    const { enrollmentId: pendingId } = await enroll(pending.client, classId);
    await expectCode(pending.client.rpc("withdraw_enrollment", { p_enrollment_id: pendingId, p_cause: "student", p_reason: "x" }), "INVALID_STATE");
  });

  it("refunds the unused value when the business ends the enrollment (10.5 h left at Rp150,000 = Rp1,575,000)", async () => {
    const { admin, tutor, classId, student, enrollmentId } = await paidStudent();
    await backdateActivation(enrollmentId, daysFromNow(-5));
    await lesson(tutor.client, classId, daysFromNow(-2));
    await expectCode(admin.rpc("withdraw_enrollment", { p_enrollment_id: enrollmentId, p_cause: "business", p_reason: " " }), "VALIDATION");
    const { data: refundId, error } = await admin.rpc("withdraw_enrollment", {
      p_enrollment_id: enrollmentId, p_cause: "business", p_reason: "class closed",
    });
    expect(error).toBeNull();
    const refund = await student.client.from("refunds").select("id, amount, cause, status, reason").single();
    expect(refund.data).toMatchObject({ id: refundId, amount: 1575000, cause: "business", status: "pending", reason: "class closed" });
    expect((await tutor.client.from("refunds").select()).data).toEqual([]);
    expect((await (await makeUser("student")).client.from("refunds").select()).data).toEqual([]);
  });

  it("creates no refund when every paid hour has been used", async () => {
    const { admin, tutor, classId, student, enrollmentId } = await paidStudent({ packageHours: 3 });
    await backdateActivation(enrollmentId, daysFromNow(-5));
    await lesson(tutor.client, classId, daysFromNow(-3));
    await lesson(tutor.client, classId, daysFromNow(-2)); // 2 x 90 min = the whole 3 h package
    const { data, error } = await admin.rpc("withdraw_enrollment", { p_enrollment_id: enrollmentId, p_cause: "business", p_reason: "closed" });
    expect(error).toBeNull();
    expect(data).toBeNull();
    expect((await student.client.from("refunds").select()).data).toEqual([]);
  });
});

describe("refund records", () => {
  it("lets only the admin create an exception refund, with a positive amount and a reason", async () => {
    const { admin, student, enrollmentId } = await paidStudent();
    await expectCode(student.client.rpc("create_exception_refund", { p_enrollment_id: enrollmentId, p_amount: 1000, p_reason: "please" }), "NOT_ALLOWED");
    await expectCode(admin.rpc("create_exception_refund", { p_enrollment_id: enrollmentId, p_amount: 0, p_reason: "x" }), "VALIDATION");
    await expectCode(admin.rpc("create_exception_refund", { p_enrollment_id: enrollmentId, p_amount: 1000, p_reason: " " }), "VALIDATION");
    const { data, error } = await admin.rpc("create_exception_refund", { p_enrollment_id: enrollmentId, p_amount: 500000, p_reason: "family moved away" });
    expect(error).toBeNull();
    const refund = await student.client.from("refunds").select("amount, cause, status").eq("id", data).single();
    expect(refund.data).toEqual({ amount: 500000, cause: "exception", status: "pending" });
  });

  it("moves pending -> refunded (final, with the bank reference) or pending -> cancelled, never both", async () => {
    const { admin, student, enrollmentId } = await paidStudent();
    const make = async () =>
      (await admin.rpc("create_exception_refund", { p_enrollment_id: enrollmentId, p_amount: 100000, p_reason: "goodwill" })).data as string;
    const first = await make();
    await expectCode(student.client.rpc("mark_refunded", { p_refund_id: first, p_bank_reference: "TRX-1" }), "NOT_ALLOWED");
    await expectCode(admin.rpc("mark_refunded", { p_refund_id: first, p_bank_reference: " " }), "VALIDATION");
    expect((await admin.rpc("mark_refunded", { p_refund_id: first, p_bank_reference: "TRX-8812" })).error).toBeNull();
    const done = await student.client.from("refunds").select("status, bank_reference, refunded_at").eq("id", first).single();
    expect(done.data).toMatchObject({ status: "refunded", bank_reference: "TRX-8812" });
    expect(done.data!.refunded_at).not.toBeNull();
    await expectCode(admin.rpc("cancel_refund", { p_refund_id: first, p_reason: "too late" }), "INVALID_STATE");
    await expectCode(admin.rpc("mark_refunded", { p_refund_id: first, p_bank_reference: "TRX-9" }), "INVALID_STATE");

    const second = await make();
    await expectCode(admin.rpc("cancel_refund", { p_refund_id: second, p_reason: " " }), "VALIDATION");
    expect((await admin.rpc("cancel_refund", { p_refund_id: second, p_reason: "created by mistake" })).error).toBeNull();
    await expectCode(admin.rpc("mark_refunded", { p_refund_id: second, p_bank_reference: "TRX-10" }), "INVALID_STATE");
  });
});
