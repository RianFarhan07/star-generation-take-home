import { describe, expect, it } from "vitest";
import { expectCode, makeUser } from "../helpers/clients";
import { adminClient, createClass, enroll, hoursFromNow, runClassJobs } from "../helpers/fixtures";

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

async function offerOf(client: Client, classId: string): Promise<string | null> {
  const { data } = await client.from("waitlist").select("offered_until").eq("class_id", classId).maybeSingle();
  return (data?.offered_until as string | null) ?? null;
}

describe("joining the waitlist", () => {
  it("lets students queue for a full class, in order", async () => {
    const { classId } = await setup();
    const holder = await makeUser("student");
    await enroll(holder.client, classId);
    const b = await makeUser("student");
    const c = await makeUser("student");
    expect((await b.client.rpc("join_waitlist", { p_class_id: classId })).error).toBeNull();
    expect((await c.client.rpc("join_waitlist", { p_class_id: classId })).error).toBeNull();
    expect(await catalog(b.client, classId)).toMatchObject({ on_waitlist: true, waitlist_position: 1, seats_left: 0, offer_until: null });
    expect(await catalog(c.client, classId)).toMatchObject({ on_waitlist: true, waitlist_position: 2 });
    await expectCode(b.client.rpc("join_waitlist", { p_class_id: classId }), "INVALID_STATE");
  });

  it("refuses when a seat is free, when the student is already enrolled, and for non-students", async () => {
    const { tutor, classId } = await setup(2);
    const student = await makeUser("student");
    await expectCode(student.client.rpc("join_waitlist", { p_class_id: classId }), "VALIDATION"); // a seat is free
    await enroll(student.client, classId);
    await enroll((await makeUser("student")).client, classId);
    await expectCode(student.client.rpc("join_waitlist", { p_class_id: classId }), "ALREADY_ENROLLED");
    await expectCode(tutor.client.rpc("join_waitlist", { p_class_id: classId }), "NOT_ALLOWED");
  });
});

describe("a freed seat is offered to the first in line", () => {
  async function queue() {
    const ctx = await setup();
    const holder = await makeUser("student");
    const { enrollmentId } = await enroll(holder.client, ctx.classId);
    const [b, c, outsider] = [await makeUser("student"), await makeUser("student"), await makeUser("student")];
    await b.client.rpc("join_waitlist", { p_class_id: ctx.classId });
    await c.client.rpc("join_waitlist", { p_class_id: ctx.classId });
    return { ...ctx, holder, enrollmentId, b, c, outsider };
  }

  it("gives the seat to the first waiting student for 24 hours and tells them", async () => {
    const { classId, holder, enrollmentId, b, c } = await queue();
    expect((await holder.client.rpc("cancel_pending_enrollment", { p_enrollment_id: enrollmentId })).error).toBeNull();

    const until = await offerOf(b.client, classId);
    expect(until).not.toBeNull();
    expect(Math.abs(Date.parse(until!) - Date.now() - 24 * 3600_000)).toBeLessThan(60_000);
    expect(await offerOf(c.client, classId)).toBeNull();

    const notes = await b.client.from("notifications").select("kind").eq("kind", "seat_offered");
    expect(notes.data).toHaveLength(1);
    expect((await c.client.from("notifications").select("kind").eq("kind", "seat_offered")).data).toEqual([]);
    expect(await catalog(b.client, classId)).toMatchObject({ seats_left: 1 });
    expect((await catalog(b.client, classId)).offer_until).not.toBeNull();
    expect(await catalog(c.client, classId)).toMatchObject({ seats_left: 0, offer_until: null });
  });

  it("keeps the seat exclusive: others are refused, the first in line can enroll and leaves the waitlist", async () => {
    const { classId, holder, enrollmentId, b, c, outsider } = await queue();
    await holder.client.rpc("cancel_pending_enrollment", { p_enrollment_id: enrollmentId });
    await expectCode(outsider.client.rpc("enroll_in_class", { p_class_id: classId, p_accept_terms: true }), "CLASS_FULL");
    await expectCode(c.client.rpc("enroll_in_class", { p_class_id: classId, p_accept_terms: true }), "CLASS_FULL");

    expect((await b.client.rpc("enroll_in_class", { p_class_id: classId, p_accept_terms: true })).error).toBeNull();
    expect((await b.client.from("waitlist").select()).data).toEqual([]);
    expect(await catalog(c.client, classId)).toMatchObject({ on_waitlist: true, waitlist_position: 1 });
  });

  it("passes an unused offer to the next student once the 24 hours are over", async () => {
    const { classId, holder, enrollmentId, b, c } = await queue();
    await holder.client.rpc("cancel_pending_enrollment", { p_enrollment_id: enrollmentId });
    await runClassJobs(hoursFromNow(23), [classId]);
    expect(await offerOf(b.client, classId)).not.toBeNull();
    expect(await offerOf(c.client, classId)).toBeNull();

    await runClassJobs(hoursFromNow(25), [classId]);
    expect((await b.client.from("waitlist").select()).data).toEqual([]); // b lost the place
    expect(await offerOf(c.client, classId)).not.toBeNull();
    await expectCode(b.client.rpc("enroll_in_class", { p_class_id: classId, p_accept_terms: true }), "CLASS_FULL");
    expect((await c.client.rpc("enroll_in_class", { p_class_id: classId, p_accept_terms: true })).error).toBeNull();
  });

  it("passes the seat on when the offered student leaves the waitlist", async () => {
    const { classId, holder, enrollmentId, b, c } = await queue();
    await holder.client.rpc("cancel_pending_enrollment", { p_enrollment_id: enrollmentId });
    expect((await b.client.rpc("leave_waitlist", { p_class_id: classId })).error).toBeNull();
    expect(await offerOf(c.client, classId)).not.toBeNull();
  });
});

describe("other ways a seat appears", () => {
  it("offers a seat created by a capacity increase, one per free seat", async () => {
    const { admin, classId } = await setup(1);
    await enroll((await makeUser("student")).client, classId);
    const [b, c] = [await makeUser("student"), await makeUser("student")];
    await b.client.rpc("join_waitlist", { p_class_id: classId });
    await c.client.rpc("join_waitlist", { p_class_id: classId });
    expect((await admin.rpc("set_class_capacity", { p_class_id: classId, p_capacity: 2 })).error).toBeNull();
    expect(await offerOf(b.client, classId)).not.toBeNull();
    expect(await offerOf(c.client, classId)).toBeNull();
  });

  it("offers a seat when the holder's payment is rejected", async () => {
    const { admin, classId } = await setup(1);
    const holder = await makeUser("student");
    const { invoiceId } = await enroll(holder.client, classId);
    const b = await makeUser("student");
    await b.client.rpc("join_waitlist", { p_class_id: classId });
    const { data: paymentId } = await holder.client.rpc("report_payment", {
      p_invoice_id: invoiceId, p_sender_name: "H", p_bank: "BCA", p_transfer_date: "2026-11-24", p_amount: 1800000,
    });
    await admin.rpc("reject_payment", { p_payment_id: paymentId, p_reason: "not found" });
    expect(await offerOf(b.client, classId)).not.toBeNull();
  });
});

describe("who can see the waitlist", () => {
  it("shows a student only their own entry, a tutor nothing, and the admin everything", async () => {
    const { admin, tutor, classId } = await setup();
    await enroll((await makeUser("student")).client, classId);
    const b = await makeUser("student");
    const c = await makeUser("student");
    await b.client.rpc("join_waitlist", { p_class_id: classId });
    await c.client.rpc("join_waitlist", { p_class_id: classId });
    expect((await b.client.from("waitlist").select()).data).toHaveLength(1);
    expect((await tutor.client.from("waitlist").select()).data).toEqual([]);
    expect((await admin.from("waitlist").select().eq("class_id", classId)).data).toHaveLength(2);
    const direct = await b.client.from("waitlist").insert({ class_id: classId, student_id: b.id });
    expect(direct.error).not.toBeNull();
  });
});
