import { describe, expect, it } from "vitest";
import { expectCode, makeUser } from "../helpers/clients";
import { adminClient, createClass, enroll, hoursFromNow, runJobs } from "../helpers/fixtures";

type Client = Awaited<ReturnType<typeof makeUser>>["client"];

async function setup(capacity = 1) {
  const admin = await adminClient();
  const tutor = await makeUser("tutor");
  const classId = await createClass(admin, { tutorId: tutor.id, capacity });
  return { admin, tutor, classId };
}

async function catalog(client: Client, classId: string) {
  const { data, error } = await client.rpc("list_open_classes");
  expect(error).toBeNull();
  return (data as Record<string, unknown>[]).find((c) => c.class_id === classId)!;
}

const join = (client: Client, classId: string, accept = true) => client.rpc("join_waitlist", { p_class_id: classId, p_accept_terms: accept });

/** The student's live enrollment in the class and its first invoice, as the student sees them. */
async function myEnrollment(client: Client, classId: string) {
  const enrollment = await client.from("enrollments").select("id, status, terms_accepted_at").eq("class_id", classId).maybeSingle();
  if (!enrollment.data) return null;
  const invoice = await client.from("invoices").select("id, status, amount, kind, payment_due_at").eq("enrollment_id", enrollment.data.id).maybeSingle();
  return { ...enrollment.data, invoice: invoice.data };
}

describe("joining the waitlist", () => {
  it("lets students queue for a full class, in order, once they accept the no-refund terms", async () => {
    const { classId } = await setup();
    await enroll((await makeUser("student")).client, classId);
    const b = await makeUser("student");
    const c = await makeUser("student");
    await expectCode(join(b.client, classId, false), "TERMS_REQUIRED");
    expect((await join(b.client, classId)).error).toBeNull();
    expect((await join(c.client, classId)).error).toBeNull();
    expect(await catalog(b.client, classId)).toMatchObject({ on_waitlist: true, waitlist_position: 1, seats_left: 0 });
    expect(await catalog(c.client, classId)).toMatchObject({ on_waitlist: true, waitlist_position: 2 });
    await expectCode(join(b.client, classId), "INVALID_STATE");
  });

  it("refuses when a seat is free, when the student is already enrolled, and for non-students", async () => {
    const { tutor, classId } = await setup(2);
    const student = await makeUser("student");
    await expectCode(join(student.client, classId), "VALIDATION"); // a seat is free
    await enroll(student.client, classId);
    await enroll((await makeUser("student")).client, classId);
    await expectCode(join(student.client, classId), "ALREADY_ENROLLED");
    await expectCode(join(tutor.client, classId), "NOT_ALLOWED");
  });

  it("lets a student leave the waitlist", async () => {
    const { classId } = await setup();
    await enroll((await makeUser("student")).client, classId);
    const b = await makeUser("student");
    await join(b.client, classId);
    expect((await b.client.rpc("leave_waitlist", { p_class_id: classId })).error).toBeNull();
    expect((await b.client.from("waitlist").select()).data).toEqual([]);
    expect((await b.client.rpc("leave_waitlist", { p_class_id: classId })).error).toBeNull(); // leaving twice is harmless
  });
});

describe("a freed seat becomes an invoice for the first in line", () => {
  async function queue() {
    const ctx = await setup();
    const holder = await makeUser("student");
    const { enrollmentId } = await enroll(holder.client, ctx.classId);
    const [b, c, outsider] = [await makeUser("student"), await makeUser("student"), await makeUser("student")];
    await join(b.client, ctx.classId);
    await join(c.client, ctx.classId);
    return { ...ctx, holder, enrollmentId, b, c, outsider };
  }

  it("enrols the first waiting student with an unpaid invoice and a 24 hour window, and tells them", async () => {
    const { classId, holder, enrollmentId, b, c } = await queue();
    expect((await holder.client.rpc("cancel_pending_enrollment", { p_enrollment_id: enrollmentId })).error).toBeNull();

    const mine = await myEnrollment(b.client, classId);
    expect(mine).toMatchObject({ status: "pending_payment", invoice: { status: "unpaid", kind: "initial", amount: 1800000 } });
    expect(mine!.terms_accepted_at).not.toBeNull();
    expect(Math.abs(Date.parse(mine!.invoice!.payment_due_at as string) - Date.now() - 24 * 3600_000)).toBeLessThan(60_000);

    expect((await b.client.from("waitlist").select()).data).toEqual([]); // b left the line by being enrolled
    expect(await catalog(c.client, classId)).toMatchObject({ on_waitlist: true, waitlist_position: 1, seats_left: 0 });
    expect(await myEnrollment(c.client, classId)).toBeNull();

    const notes = await b.client.from("notifications").select("kind, link").eq("kind", "seat_offered");
    expect(notes.data).toHaveLength(1);
    expect(notes.data![0].link).toBe(`/student/invoices/${mine!.invoice!.id}`);
    expect((await c.client.from("notifications").select("kind").eq("kind", "seat_offered")).data).toEqual([]);
  });

  it("does not let a newcomer take the seat that went to the first in line", async () => {
    const { classId, holder, enrollmentId, outsider } = await queue();
    await holder.client.rpc("cancel_pending_enrollment", { p_enrollment_id: enrollmentId });
    await expectCode(outsider.client.rpc("enroll_in_class", { p_class_id: classId, p_accept_terms: true }), "CLASS_FULL");
    expect(await catalog(outsider.client, classId)).toMatchObject({ seats_left: 0 });
  });

  it("passes the seat to the next student when the invoice is not paid within 24 hours", async () => {
    const { classId, holder, enrollmentId, b, c } = await queue();
    await holder.client.rpc("cancel_pending_enrollment", { p_enrollment_id: enrollmentId });
    const mine = await myEnrollment(b.client, classId);
    await runJobs(hoursFromNow(25), [mine!.id]);
    expect((await myEnrollment(b.client, classId))?.status).toBe("cancelled");
    expect(await myEnrollment(c.client, classId)).toMatchObject({ status: "pending_payment" });
    expect((await c.client.from("waitlist").select()).data).toEqual([]);
  });

  it("passes the seat on when the enrolled student cancels", async () => {
    const { classId, holder, enrollmentId, b, c } = await queue();
    await holder.client.rpc("cancel_pending_enrollment", { p_enrollment_id: enrollmentId });
    const mine = await myEnrollment(b.client, classId);
    expect((await b.client.rpc("cancel_pending_enrollment", { p_enrollment_id: mine!.id })).error).toBeNull();
    expect(await myEnrollment(c.client, classId)).toMatchObject({ status: "pending_payment" });
  });

  it("skips a student who left the waitlist", async () => {
    const { classId, holder, enrollmentId, b, c } = await queue();
    await b.client.rpc("leave_waitlist", { p_class_id: classId });
    await holder.client.rpc("cancel_pending_enrollment", { p_enrollment_id: enrollmentId });
    expect(await myEnrollment(b.client, classId)).toBeNull();
    expect(await myEnrollment(c.client, classId)).toMatchObject({ status: "pending_payment" });
  });
});

describe("other ways a seat appears", () => {
  it("enrols one waiting student per free seat when the capacity grows", async () => {
    const { admin, classId } = await setup(1);
    await enroll((await makeUser("student")).client, classId);
    const [b, c, d] = [await makeUser("student"), await makeUser("student"), await makeUser("student")];
    for (const s of [b, c, d]) await join(s.client, classId);
    expect((await admin.rpc("set_class_capacity", { p_class_id: classId, p_capacity: 3 })).error).toBeNull();
    expect(await myEnrollment(b.client, classId)).toMatchObject({ status: "pending_payment" });
    expect(await myEnrollment(c.client, classId)).toMatchObject({ status: "pending_payment" });
    expect(await myEnrollment(d.client, classId)).toBeNull();
    expect(await catalog(d.client, classId)).toMatchObject({ on_waitlist: true, waitlist_position: 1 });
  });

  it("enrols the next student when the holder's payment is rejected", async () => {
    const { admin, classId } = await setup(1);
    const holder = await makeUser("student");
    const { invoiceId } = await enroll(holder.client, classId);
    const b = await makeUser("student");
    await join(b.client, classId);
    const { data: paymentId } = await holder.client.rpc("report_payment", {
      p_invoice_id: invoiceId, p_sender_name: "H", p_bank: "BCA", p_transfer_date: "2026-11-24", p_amount: 1800000,
    });
    await admin.rpc("reject_payment", { p_payment_id: paymentId, p_reason: "not found" });
    expect(await myEnrollment(b.client, classId)).toMatchObject({ status: "pending_payment" });
  });
});

describe("who can see the waitlist", () => {
  it("shows a student only their own entry, a tutor nothing, and the admin everything", async () => {
    const { admin, tutor, classId } = await setup();
    await enroll((await makeUser("student")).client, classId);
    const b = await makeUser("student");
    const c = await makeUser("student");
    await join(b.client, classId);
    await join(c.client, classId);
    expect((await b.client.from("waitlist").select()).data).toHaveLength(1);
    expect((await tutor.client.from("waitlist").select()).data).toEqual([]);
    expect((await admin.from("waitlist").select().eq("class_id", classId)).data).toHaveLength(2);
    const direct = await b.client.from("waitlist").insert({ class_id: classId, student_id: b.id });
    expect(direct.error).not.toBeNull();
  });
});
