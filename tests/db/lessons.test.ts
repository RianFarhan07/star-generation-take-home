import { describe, expect, it } from "vitest";
import { expectCode, makeUser } from "../helpers/clients";
import { adminClient, createClass, daysFromNow, lesson } from "../helpers/fixtures";
import { wibInputToUtcIso } from "../../src/lib/time";

async function setup() {
  const admin = await adminClient();
  const tutor = await makeUser("tutor");
  const classId = await createClass(admin, { tutorId: tutor.id });
  return { admin, tutor, classId };
}

describe("lesson times", () => {
  it("rejects a lesson that ends before it starts", async () => {
    const { tutor, classId } = await setup();
    const start = daysFromNow(3);
    await expectCode(
      tutor.client.rpc("create_lesson", {
        p_class_id: classId,
        p_starts_at: start.toISOString(),
        p_ends_at: new Date(start.getTime() - 60_000).toISOString(),
      }),
      "VALIDATION",
    );
  });

  it("stores a WIB form input as the right UTC instant and a generated duration", async () => {
    const { tutor, classId } = await setup();
    const startsAt = wibInputToUtcIso("2026-11-01", "06:00");
    const endsAt = wibInputToUtcIso("2026-11-01", "07:30");
    const { data, error } = await tutor.client.rpc("create_lesson", { p_class_id: classId, p_starts_at: startsAt, p_ends_at: endsAt });
    expect(error).toBeNull();
    const stored = await tutor.client.from("lessons").select("starts_at, duration_minutes, tutor_id").eq("id", data).single();
    expect(Date.parse(stored.data!.starts_at)).toBe(Date.parse("2026-10-31T23:00:00Z"));
    expect(stored.data!.duration_minutes).toBe(90);
    expect(stored.data!.tutor_id).toBe(tutor.id);
  });
});

describe("a tutor's lessons cannot overlap", () => {
  it("refuses overlapping lessons even in two different classes", async () => {
    const admin = await adminClient();
    const tutor = await makeUser("tutor");
    const classA = await createClass(admin, { tutorId: tutor.id });
    const classB = await createClass(admin, { tutorId: tutor.id });
    const start = daysFromNow(4);
    await lesson(tutor.client, classA, start);
    await expectCode(
      tutor.client.rpc("create_lesson", {
        p_class_id: classB,
        p_starts_at: new Date(start.getTime() + 30 * 60_000).toISOString(),
        p_ends_at: new Date(start.getTime() + 120 * 60_000).toISOString(),
      }),
      "LESSON_OVERLAP",
    );
  });

  it("allows back-to-back lessons (the end of one is the start of the next)", async () => {
    const { tutor, classId } = await setup();
    const start = daysFromNow(5, 10);
    await lesson(tutor.client, classId, start, 90);
    const second = await tutor.client.rpc("create_lesson", {
      p_class_id: classId,
      p_starts_at: new Date(start.getTime() + 90 * 60_000).toISOString(),
      p_ends_at: new Date(start.getTime() + 180 * 60_000).toISOString(),
    });
    expect(second.error).toBeNull();
  });

  it("frees the slot when a lesson is cancelled", async () => {
    const { tutor, classId } = await setup();
    const start = daysFromNow(6);
    const first = await lesson(tutor.client, classId, start);
    const { error } = await tutor.client.rpc("cancel_lesson", { p_lesson_id: first, p_reason: "tutor is sick" });
    expect(error).toBeNull();
    const replacement = await tutor.client.rpc("create_lesson", {
      p_class_id: classId,
      p_starts_at: new Date(start.getTime() + 15 * 60_000).toISOString(),
      p_ends_at: new Date(start.getTime() + 105 * 60_000).toISOString(),
    });
    expect(replacement.error).toBeNull();
  });
});

describe("who may schedule and cancel", () => {
  it("lets the admin schedule a lesson for the class's tutor", async () => {
    const { admin, tutor, classId } = await setup();
    const id = await lesson(admin, classId, daysFromNow(7));
    const stored = await tutor.client.from("lessons").select("tutor_id").eq("id", id).single();
    expect(stored.data!.tutor_id).toBe(tutor.id);
  });

  it("refuses another tutor and students", async () => {
    const { classId } = await setup();
    const other = await makeUser("tutor");
    const student = await makeUser("student");
    const args = { p_class_id: classId, p_starts_at: daysFromNow(8).toISOString(), p_ends_at: daysFromNow(8, 17).toISOString() };
    await expectCode(other.client.rpc("create_lesson", args), "NOT_ALLOWED");
    await expectCode(student.client.rpc("create_lesson", args), "NOT_ALLOWED");
  });

  it("requires a reason to cancel and refuses cancelling twice", async () => {
    const { tutor, classId } = await setup();
    const id = await lesson(tutor.client, classId, daysFromNow(9));
    await expectCode(tutor.client.rpc("cancel_lesson", { p_lesson_id: id, p_reason: "   " }), "VALIDATION");
    const { error } = await tutor.client.rpc("cancel_lesson", { p_lesson_id: id, p_reason: "public holiday" });
    expect(error).toBeNull();
    await expectCode(tutor.client.rpc("cancel_lesson", { p_lesson_id: id, p_reason: "again" }), "INVALID_STATE");
    const stored = await tutor.client.from("lessons").select("status, cancel_reason, cancelled_by").eq("id", id).single();
    expect(stored.data).toMatchObject({ status: "cancelled", cancel_reason: "public holiday", cancelled_by: tutor.id });
  });

  it("does not let another tutor or a student cancel", async () => {
    const { tutor, classId } = await setup();
    const id = await lesson(tutor.client, classId, daysFromNow(10));
    const other = await makeUser("tutor");
    const student = await makeUser("student");
    await expectCode(other.client.rpc("cancel_lesson", { p_lesson_id: id, p_reason: "nope" }), "NOT_ALLOWED");
    await expectCode(student.client.rpc("cancel_lesson", { p_lesson_id: id, p_reason: "nope" }), "NOT_ALLOWED");
  });

  it("changes a lesson's time only while it is scheduled and still collision-free", async () => {
    const { tutor, classId } = await setup();
    const first = await lesson(tutor.client, classId, daysFromNow(11, 9));
    const second = await lesson(tutor.client, classId, daysFromNow(11, 14));
    const move = await tutor.client.rpc("update_lesson_time", {
      p_lesson_id: second,
      p_starts_at: daysFromNow(11, 15).toISOString(),
      p_ends_at: daysFromNow(11, 16).toISOString(),
    });
    expect(move.error).toBeNull();
    await expectCode(
      tutor.client.rpc("update_lesson_time", {
        p_lesson_id: second,
        p_starts_at: daysFromNow(11, 9).toISOString(),
        p_ends_at: daysFromNow(11, 10).toISOString(),
      }),
      "LESSON_OVERLAP",
    );
    await tutor.client.rpc("cancel_lesson", { p_lesson_id: first, p_reason: "moved" });
    await expectCode(
      tutor.client.rpc("update_lesson_time", {
        p_lesson_id: first,
        p_starts_at: daysFromNow(12).toISOString(),
        p_ends_at: daysFromNow(12, 17).toISOString(),
      }),
      "INVALID_STATE",
    );
  });

  it("blocks direct inserts, updates and deletes on lessons", async () => {
    const { tutor, classId } = await setup();
    const id = await lesson(tutor.client, classId, daysFromNow(13));
    const insert = await tutor.client.from("lessons").insert({
      class_id: classId, tutor_id: tutor.id, starts_at: daysFromNow(14).toISOString(), ends_at: daysFromNow(14, 17).toISOString(),
    });
    expect(insert.error).not.toBeNull();
    const update = await tutor.client.from("lessons").update({ status: "cancelled" }).eq("id", id).select();
    expect(update.error !== null || update.data?.length === 0).toBe(true);
    const del = await tutor.client.from("lessons").delete().eq("id", id).select();
    expect(del.error !== null || del.data?.length === 0).toBe(true);
  });
});
