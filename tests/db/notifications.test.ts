import { describe, expect, it } from "vitest";
import { makeUser } from "../helpers/clients";
import {
  adminClient, backdateActivation, createClass, daysFromNow, enroll, enrollAndPay, lesson, previousMonth, reportPayment,
} from "../helpers/fixtures";

type Note = { kind: string; title: string; body: string; link: string | null; read_at: string | null };

async function notesOf(client: Awaited<ReturnType<typeof makeUser>>["client"]): Promise<Note[]> {
  const { data, error } = await client.from("notifications").select("kind, title, body, link, read_at").order("created_at");
  if (error) throw new Error(error.message);
  return data as Note[];
}

async function setup() {
  const admin = await adminClient();
  const tutor = await makeUser("tutor");
  const classId = await createClass(admin, { tutorId: tutor.id });
  return { admin, tutor, classId };
}

const text = { p_topic: "Fractions", p_activities: "Exercises", p_observation: "Good", p_recommendation: "Practise" };

describe("payments and invoices", () => {
  it("tells a student about a new invoice, with the amount and a link, and nobody else", async () => {
    const { classId } = await setup();
    const student = await makeUser("student");
    const other = await makeUser("student");
    const { invoiceId } = await enroll(student.client, classId);
    const notes = await notesOf(student.client);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: "invoice_issued", read_at: null });
    expect(notes[0].title).toContain("Rp1,800,000");
    expect(notes[0].link).toBe(`/student/invoices/${invoiceId}`);
    expect(await notesOf(other.client)).toEqual([]);
  });

  it("tells the student when the admin verifies or rejects a payment", async () => {
    const { admin, classId } = await setup();
    const paid = await makeUser("student");
    await enrollAndPay(paid.client, admin, classId);
    expect((await notesOf(paid.client)).map((n) => n.kind)).toEqual(["invoice_issued", "payment_verified"]);

    const rejected = await makeUser("student");
    const { invoiceId } = await enroll(rejected.client, classId);
    const paymentId = await reportPayment(rejected.client, invoiceId);
    await admin.rpc("reject_payment", { p_payment_id: paymentId, p_reason: "not on the statement" });
    const notes = await notesOf(rejected.client);
    expect(notes[notes.length - 1]).toMatchObject({ kind: "payment_rejected" });
    expect(notes[notes.length - 1].body).toContain("not on the statement");
  });
});

describe("marking one notification as read", () => {
  it("marks only that notification and only for its owner", async () => {
    const { admin, classId } = await setup();
    const student = await makeUser("student");
    await enrollAndPay(student.client, admin, classId); // two notifications: invoice issued, payment verified
    const other = await makeUser("student");
    const before = await student.client.from("notifications").select("id, read_at").order("created_at");
    expect(before.data).toHaveLength(2);
    const [first, second] = before.data!;

    await other.client.rpc("mark_notification_read", { p_id: first.id }); // not theirs: nothing happens
    const untouched = await student.client.from("notifications").select("read_at");
    expect(untouched.data!.every((n) => n.read_at === null)).toBe(true);

    expect((await student.client.rpc("mark_notification_read", { p_id: first.id })).error).toBeNull();
    const after = await student.client.from("notifications").select("id, read_at");
    expect(after.data!.find((n) => n.id === first.id)!.read_at).not.toBeNull();
    expect(after.data!.find((n) => n.id === second.id)!.read_at).toBeNull();
  });
});

describe("lessons", () => {
  it("tells paid students, and only them, when a lesson is cancelled", async () => {
    const { admin, tutor, classId } = await setup();
    const paid = await makeUser("student");
    await enrollAndPay(paid.client, admin, classId);
    const unpaid = await makeUser("student");
    await enroll(unpaid.client, classId);
    const id = await lesson(tutor.client, classId, daysFromNow(5));
    await tutor.client.rpc("cancel_lesson", { p_lesson_id: id, p_reason: "tutor is ill" });

    const cancelled = (await notesOf(paid.client)).filter((n) => n.kind === "lesson_cancelled");
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].body).toContain("tutor is ill");
    expect((await notesOf(unpaid.client)).filter((n) => n.kind === "lesson_cancelled")).toEqual([]);
    expect((await notesOf(tutor.client)).filter((n) => n.kind === "lesson_cancelled")).toEqual([]);
  });
});

describe("logbooks", () => {
  it("notifies the admin on submit, the tutor on changes and approval, and paid students on approval", async () => {
    const { admin, tutor, classId } = await setup();
    const student = await makeUser("student");
    const { enrollmentId } = await enrollAndPay(student.client, admin, classId);
    await backdateActivation(enrollmentId, previousMonth().at(1));
    const id = await lesson(tutor.client, classId, previousMonth().at(5));
    await tutor.client.rpc("upsert_logbook_entry", { p_lesson_id: id, ...text });
    const { data: books } = await tutor.client.from("logbooks").select("id").eq("class_id", classId);
    const logbookId = books![0].id as string;

    await tutor.client.rpc("submit_logbook", { p_logbook_id: logbookId });
    const forAdmin = (await notesOf(admin)).filter((n) => n.kind === "logbook_submitted" && n.link === `/admin/logbooks/${logbookId}`);
    expect(forAdmin).toHaveLength(1);

    await admin.rpc("request_logbook_changes", { p_logbook_id: logbookId, p_comment: "Add more detail" });
    const changes = (await notesOf(tutor.client)).filter((n) => n.kind === "logbook_changes_requested");
    expect(changes).toHaveLength(1);
    expect(changes[0].body).toContain("Add more detail");
    expect(changes[0].link).toBe(`/tutor/logbooks/${classId}/${previousMonth().firstDay.slice(0, 7)}`);

    await tutor.client.rpc("submit_logbook", { p_logbook_id: logbookId });
    expect((await notesOf(student.client)).filter((n) => n.kind === "logbook_approved")).toEqual([]);
    await admin.rpc("approve_logbook", { p_logbook_id: logbookId });
    expect((await notesOf(tutor.client)).filter((n) => n.kind === "logbook_approved")).toHaveLength(1);
    const forStudent = (await notesOf(student.client)).filter((n) => n.kind === "logbook_approved");
    expect(forStudent).toHaveLength(1);
    expect(forStudent[0].link).toBe(`/student/classes/${classId}`);
  });
});

describe("refunds", () => {
  it("tells the student when a refund is recorded and when it has been repaid", async () => {
    const { admin, classId } = await setup();
    const student = await makeUser("student");
    const { enrollmentId } = await enrollAndPay(student.client, admin, classId);
    const { data: refundId } = await admin.rpc("create_exception_refund", { p_enrollment_id: enrollmentId, p_amount: 300000, p_reason: "goodwill" });
    expect((await notesOf(student.client)).map((n) => n.kind)).toContain("refund_recorded");
    await admin.rpc("mark_refunded", { p_refund_id: refundId, p_bank_reference: "TRX-77" });
    const repaid = (await notesOf(student.client)).filter((n) => n.kind === "refund_repaid");
    expect(repaid).toHaveLength(1);
    expect(repaid[0].body).toContain("TRX-77");
  });
});

describe("reading notifications", () => {
  it("marks only the caller's notifications as read", async () => {
    const { classId } = await setup();
    const a = await makeUser("student");
    const b = await makeUser("student");
    await enroll(a.client, classId);
    await enroll(b.client, classId);
    const { data, error } = await a.client.rpc("mark_notifications_read");
    expect(error).toBeNull();
    expect(data).toBe(1);
    expect((await notesOf(a.client))[0].read_at).not.toBeNull();
    expect((await notesOf(b.client))[0].read_at).toBeNull();
    expect((await a.client.rpc("mark_notifications_read")).data).toBe(0);
  });

  it("cannot be written directly or read across users", async () => {
    const { classId } = await setup();
    const a = await makeUser("student");
    const b = await makeUser("student");
    await enroll(a.client, classId);
    const insert = await b.client.from("notifications").insert({ user_id: a.id, kind: "x", title: "fake" });
    expect(insert.error).not.toBeNull();
    const peek = await b.client.from("notifications").select().eq("user_id", a.id);
    expect(peek.data).toEqual([]);
  });
});
