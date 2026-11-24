import { describe, expect, it } from "vitest";
import { expectCode, makeUser, serviceClient } from "../helpers/clients";
import { adminClient, createClass, daysFromNow, enroll, enrollAndPay, hoursFromNow, lesson, reportPayment, runJobs } from "../helpers/fixtures";

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

describe("proof files", () => {
  it("accepts a proof path in the student's own folder and refuses one pointing elsewhere", async () => {
    const { classId } = await setup();
    const student = await makeUser("student");
    const other = await makeUser("student");
    const { invoiceId } = await enroll(student.client, classId);
    const base = { p_invoice_id: invoiceId, p_sender_name: "Budi", p_bank: "BCA", p_transfer_date: "2026-11-24", p_amount: 1800000 };
    await expectCode(student.client.rpc("report_payment", { ...base, p_proof_path: `${other.id}/someone-elses.png` }), "VALIDATION");
    await expectCode(student.client.rpc("report_payment", { ...base, p_proof_path: "../../secret.png" }), "VALIDATION");
    const { error } = await student.client.rpc("report_payment", { ...base, p_proof_path: `${student.id}/${invoiceId}-1.png` });
    expect(error).toBeNull();
  });
});

describe("verification guards", () => {
  it("refuses to verify a transfer that is less than the invoice amount, but accepts the exact amount", async () => {
    const { admin, classId } = await setup();
    const student = await makeUser("student");
    const { invoiceId } = await enroll(student.client, classId);
    const short = await student.client.rpc("report_payment", {
      p_invoice_id: invoiceId, p_sender_name: "Budi", p_bank: "BCA", p_transfer_date: "2026-11-24", p_amount: 100000,
    });
    expect(short.error).toBeNull();
    await expectCode(admin.rpc("verify_payment", { p_payment_id: short.data }), "VALIDATION");
    const invoice = await student.client.from("invoices").select("status").eq("id", invoiceId).single();
    expect(invoice.data!.status).toBe("awaiting_verification");
    const rejected = await admin.rpc("reject_payment", { p_payment_id: short.data, p_reason: "only Rp100,000 arrived" });
    expect(rejected.error).toBeNull();
  });

  it("refuses to verify when the invoice is no longer awaiting verification", async () => {
    const { admin, classId } = await setup();
    const student = await makeUser("student");
    const { invoiceId } = await enroll(student.client, classId);
    const paymentId = await reportPayment(student.client, invoiceId);
    const cancel = await serviceClient().from("invoices").update({ status: "cancelled", cancel_reason: "test" }).eq("id", invoiceId);
    expect(cancel.error).toBeNull();
    await expectCode(admin.rpc("verify_payment", { p_payment_id: paymentId }), "INVALID_STATE");
    const invoice = await student.client.from("invoices").select("status").eq("id", invoiceId).single();
    expect(invoice.data!.status).toBe("cancelled");
  });
});

describe("returning a short transfer to the student", () => {
  const report = (client: Awaited<ReturnType<typeof makeUser>>["client"], invoiceId: string, amount: number) =>
    client.rpc("report_payment", { p_invoice_id: invoiceId, p_sender_name: "Budi", p_bank: "BCA", p_transfer_date: "2026-11-24", p_amount: amount });

  it("keeps the seat and the invoice open for 24 more hours, so the student can report the total", async () => {
    const { admin, classId } = await setup(1);
    const student = await makeUser("student");
    const { enrollmentId, invoiceId } = await enroll(student.client, classId);
    const short = await report(student.client, invoiceId, 10000);
    expect(short.error).toBeNull();

    const { error } = await admin.rpc("return_underpaid_payment", { p_payment_id: short.data, p_reason: "Short by Rp1,790,000: transfer the rest and report the total." });
    expect(error).toBeNull();

    const payment = await student.client.from("payments").select("status, reject_reason").eq("id", short.data).single();
    expect(payment.data).toMatchObject({ status: "rejected", reject_reason: "Short by Rp1,790,000: transfer the rest and report the total." });
    const invoice = await student.client.from("invoices").select("status, payment_due_at").eq("id", invoiceId).single();
    expect(invoice.data!.status).toBe("unpaid");
    expect(Math.abs(Date.parse(invoice.data!.payment_due_at as string) - Date.now() - 24 * 3600_000)).toBeLessThan(60_000);
    const enrollment = await student.client.from("enrollments").select("status").eq("id", enrollmentId).single();
    expect(enrollment.data!.status).toBe("pending_payment");

    // The seat is still theirs: a newcomer is refused, and the student can report the total and be verified.
    await expectCode((await makeUser("student")).client.rpc("enroll_in_class", { p_class_id: classId, p_accept_terms: true }), "CLASS_FULL");
    const total = await report(student.client, invoiceId, 1800000);
    expect(total.error).toBeNull();
    expect((await admin.rpc("verify_payment", { p_payment_id: total.data })).error).toBeNull();
    expect((await student.client.from("enrollments").select("status").eq("id", enrollmentId).single()).data!.status).toBe("active");
  });

  it("tells the student, and does not expire the enrollment before the new window ends", async () => {
    const { admin, classId } = await setup(1);
    const student = await makeUser("student");
    const { enrollmentId, invoiceId } = await enroll(student.client, classId);
    const short = await report(student.client, invoiceId, 10000);
    await admin.rpc("return_underpaid_payment", { p_payment_id: short.data, p_reason: "Short, please transfer the rest." });
    const notes = await student.client.from("notifications").select("kind, body").eq("kind", "payment_rejected");
    expect(notes.data).toHaveLength(1);
    expect(notes.data![0].body).toContain("Short, please transfer the rest.");

    expect((await runJobs(hoursFromNow(23), [enrollmentId])).expired).toBe(0);
    expect((await runJobs(hoursFromNow(25), [enrollmentId])).expired).toBe(1);
  });

  it("only applies to a transfer that is really short, only for admins, and only once", async () => {
    const { admin, classId } = await setup(2);
    const student = await makeUser("student");
    const { invoiceId } = await enroll(student.client, classId);
    const full = await report(student.client, invoiceId, 1800000);
    await expectCode(admin.rpc("return_underpaid_payment", { p_payment_id: full.data, p_reason: "x" }), "VALIDATION");

    const other = await makeUser("student");
    const { invoiceId: otherInvoice } = await enroll(other.client, classId);
    const short = await report(other.client, otherInvoice, 5000);
    await expectCode(other.client.rpc("return_underpaid_payment", { p_payment_id: short.data, p_reason: "x" }), "NOT_ALLOWED");
    await expectCode(admin.rpc("return_underpaid_payment", { p_payment_id: short.data, p_reason: "  " }), "VALIDATION");
    expect((await admin.rpc("return_underpaid_payment", { p_payment_id: short.data, p_reason: "short" })).error).toBeNull();
    await expectCode(admin.rpc("return_underpaid_payment", { p_payment_id: short.data, p_reason: "short" }), "INVALID_STATE");
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
