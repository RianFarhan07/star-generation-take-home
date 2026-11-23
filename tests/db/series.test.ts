import { describe, expect, it } from "vitest";
import { expectCode, makeUser } from "../helpers/clients";
import { adminClient, createClass, daysFromNow, lesson } from "../helpers/fixtures";

async function setup() {
  const admin = await adminClient();
  const tutor = await makeUser("tutor");
  const classId = await createClass(admin, { tutorId: tutor.id });
  return { admin, tutor, classId };
}

const series = (classId: string, first: Date, minutes = 90, weeks = 8) => ({
  p_class_id: classId, p_first_starts_at: first.toISOString(), p_minutes: minutes, p_weeks: weeks,
});

describe("weekly recurring lessons", () => {
  it("creates one lesson per week in one go, sharing a series id", async () => {
    const { tutor, classId } = await setup();
    const first = daysFromNow(10);
    const { data, error } = await tutor.client.rpc("create_lesson_series", series(classId, first));
    expect(error).toBeNull();
    expect(data).toHaveLength(8);

    const rows = await tutor.client.from("lessons").select("starts_at, duration_minutes, series_id, status").eq("class_id", classId).order("starts_at");
    expect(rows.data).toHaveLength(8);
    expect(new Set(rows.data!.map((r) => r.series_id)).size).toBe(1);
    expect(rows.data![0].series_id).not.toBeNull();
    rows.data!.forEach((r, i) => {
      expect(Date.parse(r.starts_at) - first.getTime()).toBe(i * 7 * 24 * 3600_000);
      expect(r.duration_minutes).toBe(90);
    });
  });

  it("creates nothing and names every clashing date when any week overlaps another lesson", async () => {
    const { tutor, classId } = await setup();
    const first = daysFromNow(10);
    await lesson(tutor.client, classId, new Date(first.getTime() + 3 * 7 * 24 * 3600_000 + 30 * 60_000)); // week 4, half an hour later
    const { error } = await tutor.client.rpc("create_lesson_series", series(classId, first));
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/^LESSON_OVERLAP: .*\d{2} \w{3} \d{4}/);
    const rows = await tutor.client.from("lessons").select("id").eq("class_id", classId);
    expect(rows.data).toHaveLength(1); // only the one that was already there
  });

  it("limits a series to 1-26 weeks of a sensible length", async () => {
    const { tutor, classId } = await setup();
    const first = daysFromNow(10);
    await expectCode(tutor.client.rpc("create_lesson_series", series(classId, first, 90, 0)), "VALIDATION");
    await expectCode(tutor.client.rpc("create_lesson_series", series(classId, first, 90, 27)), "VALIDATION");
    await expectCode(tutor.client.rpc("create_lesson_series", series(classId, first, 0, 4)), "VALIDATION");
    const { data } = await tutor.client.rpc("create_lesson_series", series(classId, first, 90, 26));
    expect(data).toHaveLength(26);
  });

  it("is for the class's tutor and the admin only", async () => {
    const { admin, classId } = await setup();
    const first = daysFromNow(10);
    await expectCode((await makeUser("tutor")).client.rpc("create_lesson_series", series(classId, first)), "NOT_ALLOWED");
    await expectCode((await makeUser("student")).client.rpc("create_lesson_series", series(classId, first)), "NOT_ALLOWED");
    const { data, error } = await admin.rpc("create_lesson_series", series(classId, first, 60, 3));
    expect(error).toBeNull();
    expect(data).toHaveLength(3);
  });

  it("lets a single lesson of the series be cancelled without touching the rest", async () => {
    const { tutor, classId } = await setup();
    const { data } = await tutor.client.rpc("create_lesson_series", series(classId, daysFromNow(10), 90, 4));
    const ids = data as string[];
    expect((await tutor.client.rpc("cancel_lesson", { p_lesson_id: ids[1], p_reason: "public holiday" })).error).toBeNull();
    const rows = await tutor.client.from("lessons").select("id, status").eq("class_id", classId);
    expect(rows.data!.filter((r) => r.status === "cancelled").map((r) => r.id)).toEqual([ids[1]]);
    expect(rows.data!.filter((r) => r.status === "scheduled")).toHaveLength(3);
  });
});
