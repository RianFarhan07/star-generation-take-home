import { describe, expect, it } from "vitest";
import { expectCode, makeUser } from "../helpers/clients";
import { adminClient, createClass, daysFromNow, enroll, enrollAndPay, lesson, reportPayment } from "../helpers/fixtures";

async function setup(capacity = 2) {
  const admin = await adminClient();
  const tutor = await makeUser("tutor");
  const classId = await createClass(admin, { tutorId: tutor.id, capacity });
  return { admin, tutor, classId };
}

describe("a student reports a transfer, the admin verifies it", () => {
  it("never lets a student mark their own invoice paid", async () => {
    const { classId } = await setup();
    const student = await makeUser("student");
    const { invoiceId } = await enroll(student.client, classId);
    const update = await student.client.from("invoices").update({ status: "paid" }).eq("id", invoiceId).select();
    expect(update.error !== null || update.data?.length === 0).toBe(true);
    const after = await student.client.from("invoices").select("status").eq("id", invoiceId).single();
    expect(after.data!.status).toBe("unpaid");
    await expectCode(student.client.rpc("verify_payment", { p_payment_id: crypto.randomUUID() }), "NOT_ALLOWED");
  });

  it("requires sender, bank, date and a positive amount", async () => {
    const { classId } = await setup();
    const student = await makeUser("student");
    const { invoiceId } = await enroll(student.client, classId);
    const base = { p_invoice_id: invoiceId, p_sender_name: "Budi", p_bank: "BCA", p_transfer_date: "2026-11-24", p_amount: 1800000 };
    await expectCode(student.client.rpc("report_payment", { ...base, p_sender_name: "   " }), "VALIDATION");
    await expectCode(student.client.rpc("report_payment", { ...base, p_bank: "" }), "VALIDATION");
    await expectCode(student.client.rpc("report_payment", { ...base, p_amount: 0 }), "VALIDATION");
  });

  it("moves the invoice and enrollment to awaiting verification, once", async () => {
    const { classId } = await setup();
    const student = await makeUser("student");
    const { enrollmentId, invoiceId } = await enroll(student.client, classId);
    await reportPayment(student.client, invoiceId);
    const invoice = await student.client.from("invoices").select("status").eq("id", invoiceId).single();
    const enrollment = await student.client.from("enrollments").select("status").eq("id", enrollmentId).single();
    expect(invoice.data!.status).toBe("awaiting_verification");
    expect(enrollment.data!.status).toBe("awaiting_verification");
    await expectCode(
      student.client.rpc("report_payment", {
        p_invoice_id: invoiceId, p_sender_name: "B", p_bank: "BCA", p_transfer_date: "2026-11-24", p_amount: 1800000,
      }),
      "INVALID_STATE",
    );
  });

  it("does not let someone else report a payment for the invoice", async () => {
    const { classId } = await setup();
    const owner = await makeUser("student");
    const other = await makeUser("student");
    const { invoiceId } = await enroll(owner.client, classId);
    await expectCode(
      other.client.rpc("report_payment", {
        p_invoice_id: invoiceId, p_sender_name: "X", p_bank: "BCA", p_transfer_date: "2026-11-24", p_amount: 1800000,
      }),
      "NOT_ALLOWED",
    );
  });

  it("verifies once: the invoice becomes paid and the enrollment active; a second verify is refused", async () => {
    const { admin, classId } = await setup();
    const student = await makeUser("student");
    const { enrollmentId, invoiceId, paymentId } = await enrollAndPay(student.client, admin, classId);
    const invoice = await student.client.from("invoices").select("status, paid_at").eq("id", invoiceId).single();
    const enrollment = await student.client.from("enrollments").select("status, activated_at").eq("id", enrollmentId).single();
    expect(invoice.data!.status).toBe("paid");
    expect(invoice.data!.paid_at).not.toBeNull();
    expect(enrollment.data!.status).toBe("active");
    expect(enrollment.data!.activated_at).not.toBeNull();
    await expectCode(admin.rpc("verify_payment", { p_payment_id: paymentId }), "INVALID_STATE");
    const still = await student.client.from("invoices").select("status").eq("id", invoiceId).single();
    expect(still.data!.status).toBe("paid");
  });

  it("opens the class schedule to the student only after verification", async () => {
    const { admin, tutor, classId } = await setup();
    await lesson(tutor.client, classId, daysFromNow(3));
    const student = await makeUser("student");
    const { invoiceId } = await enroll(student.client, classId);
    expect((await student.client.from("lessons").select().eq("class_id", classId)).data).toEqual([]);
    const paymentId = await reportPayment(student.client, invoiceId);
    expect((await student.client.from("lessons").select().eq("class_id", classId)).data).toEqual([]);
    await admin.rpc("verify_payment", { p_payment_id: paymentId });
    expect((await student.client.from("lessons").select().eq("class_id", classId)).data).toHaveLength(1);
  });

  it("keeps invoices and payments away from the tutor", async () => {
    const { admin, tutor, classId } = await setup();
    await enrollAndPay((await makeUser("student")).client, admin, classId);
    expect((await tutor.client.from("invoices").select()).data).toEqual([]);
    expect((await tutor.client.from("payments").select()).data).toEqual([]);
  });

  it("rejecting an initial payment cancels the enrollment and frees the seat", async () => {
    const { admin, classId } = await setup(1);
    const student = await makeUser("student");
    const { enrollmentId, invoiceId } = await enroll(student.client, classId);
    const paymentId = await reportPayment(student.client, invoiceId);
    await expectCode(admin.rpc("reject_payment", { p_payment_id: paymentId, p_reason: " " }), "VALIDATION");
    const { error } = await admin.rpc("reject_payment", { p_payment_id: paymentId, p_reason: "transfer not found on the statement" });
    expect(error).toBeNull();
    const enrollment = await student.client.from("enrollments").select("status, end_cause").eq("id", enrollmentId).single();
    expect(enrollment.data).toMatchObject({ status: "cancelled", end_cause: "rejected" });
    const invoice = await student.client.from("invoices").select("status").eq("id", invoiceId).single();
    expect(invoice.data!.status).toBe("cancelled");
    const next = await makeUser("student");
    const retry = await next.client.rpc("enroll_in_class", { p_class_id: classId, p_accept_terms: true });
    expect(retry.error).toBeNull();
  });

  it("lets the admin record an offline payment, which activates the enrollment", async () => {
    const { admin, classId } = await setup();
    const student = await makeUser("student");
    const { enrollmentId, invoiceId } = await enroll(student.client, classId);
    await expectCode(admin.rpc("mark_paid_offline", { p_invoice_id: invoiceId, p_reference: "" }), "VALIDATION");
    const { error } = await admin.rpc("mark_paid_offline", { p_invoice_id: invoiceId, p_reference: "cash receipt 17" });
    expect(error).toBeNull();
    const enrollment = await student.client.from("enrollments").select("status").eq("id", enrollmentId).single();
    expect(enrollment.data!.status).toBe("active");
    await expectCode(admin.rpc("mark_paid_offline", { p_invoice_id: invoiceId, p_reference: "again" }), "INVALID_STATE");
    const events = await admin.from("invoice_events").select("action").eq("invoice_id", invoiceId);
    expect(events.data!.map((e) => e.action)).toEqual(expect.arrayContaining(["issued", "paid_offline"]));
  });
});

describe("payment proof storage", () => {
  const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));

  it("lets a student upload into their own folder only, and the admin read it", async () => {
    const student = await makeUser("student");
    const other = await makeUser("student");
    const admin = await adminClient();
    const ownPath = `${student.id}/proof.png`;
    const up = await student.client.storage.from("payment-proofs").upload(ownPath, png, { contentType: "image/png" });
    expect(up.error).toBeNull();
    const foreign = await student.client.storage.from("payment-proofs").upload(`${other.id}/proof.png`, png, { contentType: "image/png" });
    expect(foreign.error).not.toBeNull();
    const read = await admin.storage.from("payment-proofs").download(ownPath);
    expect(read.error).toBeNull();
    expect(read.data).not.toBeNull();
    const peek = await other.client.storage.from("payment-proofs").download(ownPath);
    expect(peek.error).not.toBeNull();
  });
});
