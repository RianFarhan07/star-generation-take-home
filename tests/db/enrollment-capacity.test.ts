import { describe, expect, it } from "vitest";
import { expectCode, makeUser } from "../helpers/clients";
import { adminClient, createClass, enroll } from "../helpers/fixtures";

async function classWithTutor(o: { capacity?: number } = {}) {
  const admin = await adminClient();
  const tutor = await makeUser("tutor");
  const classId = await createClass(admin, { tutorId: tutor.id, capacity: o.capacity });
  return { admin, tutor, classId };
}

describe("enrollment rules", () => {
  it("requires accepting the no-refund terms", async () => {
    const { classId } = await classWithTutor();
    const student = await makeUser("student");
    await expectCode(student.client.rpc("enroll_in_class", { p_class_id: classId, p_accept_terms: false }), "TERMS_REQUIRED");
  });

  it("refuses a second live enrollment in the same class", async () => {
    const { classId } = await classWithTutor();
    const student = await makeUser("student");
    await enroll(student.client, classId);
    await expectCode(student.client.rpc("enroll_in_class", { p_class_id: classId, p_accept_terms: true }), "ALREADY_ENROLLED");
  });

  it("lets only students enroll", async () => {
    const { classId, tutor } = await classWithTutor();
    await expectCode(tutor.client.rpc("enroll_in_class", { p_class_id: classId, p_accept_terms: true }), "NOT_ALLOWED");
  });

  it("issues the initial invoice at the current student rate with a 24 hour payment window", async () => {
    const { classId } = await classWithTutor();
    const student = await makeUser("student");
    const { invoiceId } = await enroll(student.client, classId);
    const { data } = await student.client.from("invoices").select().eq("id", invoiceId).single();
    expect(data).toMatchObject({ kind: "initial", hours: 12, rate_per_hour: 150000, amount: 1800000, status: "unpaid" });
    const windowMs = Date.parse(data!.payment_due_at) - Date.now();
    expect(Math.abs(windowMs - 24 * 3600_000)).toBeLessThan(60_000);
  });
});

describe("capacity", () => {
  it("refuses a third student when two seats are held", async () => {
    const { classId } = await classWithTutor({ capacity: 2 });
    await enroll((await makeUser("student")).client, classId);
    await enroll((await makeUser("student")).client, classId);
    const third = await makeUser("student");
    await expectCode(third.client.rpc("enroll_in_class", { p_class_id: classId, p_accept_terms: true }), "CLASS_FULL");
  });

  it("gives the last seat to exactly one of two students who enroll at the same moment", async () => {
    const { classId } = await classWithTutor({ capacity: 1 });
    const [a, b] = await Promise.all([makeUser("student"), makeUser("student")]);
    const results = await Promise.all([
      a.client.rpc("enroll_in_class", { p_class_id: classId, p_accept_terms: true }),
      b.client.rpc("enroll_in_class", { p_class_id: classId, p_accept_terms: true }),
    ]);
    const succeeded = results.filter((r) => r.error === null);
    const failed = results.filter((r) => r.error !== null);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].error!.message.startsWith("CLASS_FULL:")).toBe(true);
  });

  it("frees the seat when the student cancels during the payment window", async () => {
    const { classId } = await classWithTutor({ capacity: 1 });
    const first = await makeUser("student");
    const { enrollmentId } = await enroll(first.client, classId);
    const second = await makeUser("student");
    await expectCode(second.client.rpc("enroll_in_class", { p_class_id: classId, p_accept_terms: true }), "CLASS_FULL");

    const { error } = await first.client.rpc("cancel_pending_enrollment", { p_enrollment_id: enrollmentId });
    expect(error).toBeNull();
    const cancelled = await first.client.from("enrollments").select("status, end_cause").eq("id", enrollmentId).single();
    expect(cancelled.data).toMatchObject({ status: "cancelled", end_cause: "student" });
    const invoice = await first.client.from("invoices").select("status").eq("enrollment_id", enrollmentId).single();
    expect(invoice.data!.status).toBe("cancelled");

    const { error: retry } = await second.client.rpc("enroll_in_class", { p_class_id: classId, p_accept_terms: true });
    expect(retry).toBeNull();
  });

  it("lets a student enroll again after cancelling (history is kept, only live enrollments count)", async () => {
    const { classId } = await classWithTutor();
    const student = await makeUser("student");
    const { enrollmentId } = await enroll(student.client, classId);
    await student.client.rpc("cancel_pending_enrollment", { p_enrollment_id: enrollmentId });
    const again = await student.client.rpc("enroll_in_class", { p_class_id: classId, p_accept_terms: true });
    expect(again.error).toBeNull();
    const all = await student.client.from("enrollments").select("status").eq("class_id", classId);
    expect(all.data).toHaveLength(2);
  });

  it("does not let someone else cancel an enrollment", async () => {
    const { classId } = await classWithTutor();
    const owner = await makeUser("student");
    const other = await makeUser("student");
    const { enrollmentId } = await enroll(owner.client, classId);
    await expectCode(other.client.rpc("cancel_pending_enrollment", { p_enrollment_id: enrollmentId }), "NOT_ALLOWED");
  });

  it("refuses to lower the capacity below the seats already held", async () => {
    const { admin, classId } = await classWithTutor({ capacity: 2 });
    await enroll((await makeUser("student")).client, classId);
    await enroll((await makeUser("student")).client, classId);
    await expectCode(admin.rpc("set_class_capacity", { p_class_id: classId, p_capacity: 1 }), "CAPACITY_BELOW_SEATS");
    const { error } = await admin.rpc("set_class_capacity", { p_class_id: classId, p_capacity: 3 });
    expect(error).toBeNull();
  });
});

describe("who can see enrollments", () => {
  it("lets the class tutor read the roster but not the invoices", async () => {
    const { classId, tutor } = await classWithTutor();
    await enroll((await makeUser("student")).client, classId);
    await enroll((await makeUser("student")).client, classId);
    const enrollments = await tutor.client.from("enrollments").select().eq("class_id", classId);
    expect(enrollments.data).toHaveLength(2);
    const invoices = await tutor.client.from("invoices").select();
    expect(invoices.data).toEqual([]);
  });

  it("shows a student only their own enrollment", async () => {
    const { classId } = await classWithTutor();
    const a = await makeUser("student");
    const b = await makeUser("student");
    await enroll(a.client, classId);
    await enroll(b.client, classId);
    const mine = await a.client.from("enrollments").select().eq("class_id", classId);
    expect(mine.data).toHaveLength(1);
  });
});
