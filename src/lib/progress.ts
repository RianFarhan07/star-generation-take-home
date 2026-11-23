// A student's progress, built only from entries of approved logbooks (the database already hides the rest).

export type ProgressEntry = { starts_at: string; topic: string; recommendation: string };

/** The latest lesson's recommendation ("what's next") and every topic covered so far, newest first. */
export function summarizeProgress(entries: ProgressEntry[]): { next: ProgressEntry | null; topics: ProgressEntry[] } {
  const topics = [...entries].sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  return { next: topics[0] ?? null, topics };
}
