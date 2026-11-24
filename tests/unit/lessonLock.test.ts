import { describe, expect, it } from "vitest";
import { isLessonLocked, lockedMonths } from "../../src/lib/lessonLock";

const books = [
  { class_id: "a", month: "2026-09-01", status: "submitted" },
  { class_id: "a", month: "2026-10-01", status: "approved" },
  { class_id: "a", month: "2026-11-01", status: "draft" },
  { class_id: "a", month: "2026-12-01", status: "changes_requested" },
];

describe("months whose lessons can no longer change", () => {
  const locked = lockedMonths(books);

  it("locks a month once its logbook is submitted or approved", () => {
    expect(isLessonLocked(locked, "a", "2026-09-12T09:00:00Z")).toBe(true);
    expect(isLessonLocked(locked, "a", "2026-10-12T09:00:00Z")).toBe(true);
  });

  it("keeps a month open while its logbook is a draft or has been sent back", () => {
    expect(isLessonLocked(locked, "a", "2026-11-12T09:00:00Z")).toBe(false);
    expect(isLessonLocked(locked, "a", "2026-12-12T09:00:00Z")).toBe(false);
  });

  it("keeps a month open when there is no logbook yet, and does not mix up classes", () => {
    expect(isLessonLocked(locked, "a", "2027-01-12T09:00:00Z")).toBe(false);
    expect(isLessonLocked(locked, "b", "2026-09-12T09:00:00Z")).toBe(false);
  });

  it("reads the month in WIB: 31 Aug 20:00 UTC is already 1 Sept in Jakarta", () => {
    expect(isLessonLocked(locked, "a", "2026-08-31T20:00:00Z")).toBe(true);
    expect(isLessonLocked(locked, "a", "2026-09-30T16:59:00Z")).toBe(true);
    expect(isLessonLocked(locked, "a", "2026-09-30T17:00:00Z")).toBe(true); // 1 Oct 00:00 WIB: October is approved too
    expect(isLessonLocked(locked, "a", "2026-10-31T17:00:00Z")).toBe(false); // 1 Nov 00:00 WIB: November is a draft
  });
});
