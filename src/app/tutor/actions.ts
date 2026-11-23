"use server";

import { requireRole } from "@/lib/session";
import { callRpc, int, text, type ActionState } from "@/lib/actions";
import { wibInputToUtcIso } from "@/lib/time";

// Every tutor action is one database function call; the database checks that the caller teaches the class.

function times(formData: FormData): { startsAt: string; endsAt: string } | null {
  try {
    return {
      startsAt: wibInputToUtcIso(text(formData, "date"), text(formData, "start")),
      endsAt: wibInputToUtcIso(text(formData, "date"), text(formData, "end")),
    };
  } catch {
    return null;
  }
}

const SCHEDULE_PATHS = ["/tutor/schedule", "/tutor/logbooks", "/tutor", "/tutor/earnings"];

export async function addLesson(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("tutor");
  const range = times(formData);
  if (!range) return { ok: false, error: "Enter a valid date and times." };

  const weeks = int(formData, "weeks") ?? 1;
  if (weeks > 1) {
    const minutes = Math.round((Date.parse(range.endsAt) - Date.parse(range.startsAt)) / 60_000);
    return callRpc(
      "create_lesson_series",
      { p_class_id: text(formData, "classId"), p_first_starts_at: range.startsAt, p_minutes: minutes, p_weeks: weeks },
      SCHEDULE_PATHS,
      `${weeks} weekly lessons scheduled.`,
    );
  }
  return callRpc(
    "create_lesson",
    { p_class_id: text(formData, "classId"), p_starts_at: range.startsAt, p_ends_at: range.endsAt },
    SCHEDULE_PATHS,
    "Lesson scheduled.",
  );
}

export async function updateLessonTime(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("tutor");
  const range = times(formData);
  if (!range) return { ok: false, error: "Enter a valid date and times." };
  return callRpc(
    "update_lesson_time",
    { p_lesson_id: text(formData, "lessonId"), p_starts_at: range.startsAt, p_ends_at: range.endsAt },
    SCHEDULE_PATHS,
  );
}

export async function cancelLesson(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("tutor");
  return callRpc("cancel_lesson", { p_lesson_id: text(formData, "lessonId"), p_reason: text(formData, "reason") }, SCHEDULE_PATHS);
}

export async function saveEntry(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("tutor");
  return callRpc(
    "upsert_logbook_entry",
    {
      p_lesson_id: text(formData, "lessonId"),
      p_topic: text(formData, "topic"),
      p_activities: text(formData, "activities"),
      p_observation: text(formData, "observation"),
      p_recommendation: text(formData, "recommendation"),
    },
    ["/tutor/logbooks", `/tutor/logbooks/${text(formData, "classId")}/${text(formData, "month")}`],
    "Entry saved.",
  );
}

export async function submitLogbook(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("tutor");
  return callRpc(
    "submit_logbook",
    { p_logbook_id: text(formData, "logbookId") },
    ["/tutor/logbooks", `/tutor/logbooks/${text(formData, "classId")}/${text(formData, "month")}`, "/tutor/schedule", "/tutor/earnings"],
    "Logbook submitted for approval.",
  );
}
