import { wibMonthStart } from "./time";

export type LogbookLock = { class_id: string; month: string; status: string };

const key = (classId: string, month: string) => `${classId}|${month}`;

/**
 * The (class, month) pairs whose logbook has been submitted or approved. The database refuses to cancel or
 * move any lesson of such a month (trigger lessons_month_lock), so the screens use this to hide those buttons
 * instead of letting a click end in an error.
 */
export function lockedMonths(logbooks: LogbookLock[]): Set<string> {
  return new Set(logbooks.filter((b) => b.status === "submitted" || b.status === "approved").map((b) => key(b.class_id, b.month)));
}

/** True when the lesson (identified by its class and start instant) falls in a locked WIB month. */
export function isLessonLocked(locked: Set<string>, classId: string, startsAt: string): boolean {
  return locked.has(key(classId, wibMonthStart(startsAt)));
}
