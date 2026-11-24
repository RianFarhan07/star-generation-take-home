/** The four texts of a logbook entry. */
export type EntryText = { topic: string; activities: string; observation: string; recommendation: string };

/** The fields in the order they appear on the form, with the label people see. */
export const ENTRY_FIELDS: { key: keyof EntryText; label: string }[] = [
  { key: "topic", label: "Topic" },
  { key: "activities", label: "Activities" },
  { key: "observation", label: "Tutor observation" },
  { key: "recommendation", label: "Future recommendation" },
];

export type FieldChange = { key: keyof EntryText; label: string; before: string; after: string };

/** The fields whose text differs between two versions of an entry (compared after trimming). */
export function entryChanges(before: EntryText, after: EntryText): FieldChange[] {
  return ENTRY_FIELDS.filter((f) => before[f.key].trim() !== after[f.key].trim()).map((f) => ({
    key: f.key,
    label: f.label,
    before: before[f.key],
    after: after[f.key],
  }));
}

/** One line of a text for a summary: whitespace collapsed, cut with an ellipsis when longer than `max`. */
export function shorten(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
