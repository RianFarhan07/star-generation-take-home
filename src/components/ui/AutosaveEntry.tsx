"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionState } from "@/lib/actions";
import { ENTRY_FIELDS, type EntryText } from "@/lib/entryDiff";
import { type AutosaveStatus, useAutosave } from "./AutosaveContext";
import { Field, Input, Textarea } from "./Field";

const DEBOUNCE_MS = 1500;

const HINTS: Partial<Record<keyof EntryText, string>> = {
  activities: "What happened in the lesson.",
  recommendation: "What comes next.",
};

const trimmed = (a: EntryText) => ENTRY_FIELDS.every((f) => a[f.key].trim() !== "");
const same = (a: EntryText, b: EntryText) => ENTRY_FIELDS.every((f) => a[f.key].trim() === b[f.key].trim());

/**
 * The four text fields of a logbook entry that save themselves: a moment after the person stops typing and
 * when they leave a field. Nothing is sent until all four fields have text (the database requires it), and
 * the page's Finalise / Approve buttons wait for the saves through AutosaveContext.
 *
 * `save` is the Server Action, `hidden` the ids it needs (lesson, class, month ... or logbook, entry).
 */
export function AutosaveEntryFields({
  id,
  initial,
  hasEntry,
  hidden,
  save,
}: {
  id: string;
  initial: EntryText;
  hasEntry: boolean;
  hidden: Record<string, string>;
  save: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const { report } = useAutosave();
  const [values, setValues] = useState<EntryText>(initial);
  const [status, setStatus] = useState<AutosaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  const [written, setWritten] = useState(hasEntry);

  const latest = useRef(initial); // what the person sees now
  const stored = useRef(hasEntry ? initial : { topic: "", activities: "", observation: "", recommendation: "" }); // what the database has
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef(false);
  const current = useRef<AutosaveStatus>("saved");

  const update = useCallback(
    (next: AutosaveStatus, message: string | null = null) => {
      current.current = next;
      setStatus(next);
      setError(message);
      report(id, next);
    },
    [id, report],
  );

  const runRef = useRef<() => Promise<void>>(async () => {}); // always the latest `run`, so a save can look again

  const run = useCallback(async (): Promise<void> => {
    if (running.current) return; // the running save looks again when it is done
    const snapshot = latest.current;
    if (same(snapshot, stored.current)) return update("saved");
    if (!trimmed(snapshot)) return update("incomplete");

    running.current = true;
    update("saving");
    const data = new FormData();
    for (const [key, value] of Object.entries(hidden)) data.set(key, value);
    for (const f of ENTRY_FIELDS) data.set(f.key, snapshot[f.key]);
    let result: ActionState;
    try {
      result = await save(null, data);
    } catch {
      result = { ok: false, error: "Could not save. Check your connection and try again." };
    }
    running.current = false;

    if (result?.ok) {
      stored.current = snapshot;
      setWritten(true);
      if (!same(latest.current, snapshot)) return runRef.current(); // more was typed while saving
      return update("saved");
    }
    update("error", result && !result.ok ? result.error : "Could not save.");
  }, [hidden, save, update]);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const cancelTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  function change(key: keyof EntryText, value: string) {
    const next = { ...latest.current, [key]: value };
    latest.current = next;
    setValues(next);
    cancelTimer();
    if (same(next, stored.current)) return update("saved");
    if (!trimmed(next)) return update("incomplete");
    update("dirty");
    timer.current = setTimeout(() => void runRef.current(), DEBOUNCE_MS);
  }

  function leaveField() {
    cancelTimer();
    void run();
  }

  // Leaving the page (a link inside the app) must not drop what was typed in the last moment.
  useEffect(() => {
    return () => {
      const pending = timer.current !== null && current.current === "dirty";
      cancelTimer();
      if (pending) void runRef.current();
      report(id, "saved");
    };
  }, [id, report]);

  // Closing the tab or reloading with unsaved text asks first.
  useEffect(() => {
    if (status === "saved") return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status]);

  const line =
    status === "saving"
      ? "Saving…"
      : status === "dirty"
        ? "Unsaved changes, saving in a moment…"
        : status === "incomplete"
          ? "Fill in all four fields to save this entry."
          : status === "error"
            ? `Could not save: ${error}`
            : written
              ? "All changes saved."
              : "Not saved yet: it saves by itself once all four fields are filled in.";

  return (
    <div className="grid gap-3">
      {ENTRY_FIELDS.map((f) => (
        <Field key={f.key} label={f.label} hint={HINTS[f.key]}>
          {f.key === "topic" ? (
            <Input value={values.topic} onChange={(e) => change("topic", e.target.value)} onBlur={leaveField} />
          ) : (
            <Textarea value={values[f.key]} onChange={(e) => change(f.key, e.target.value)} onBlur={leaveField} />
          )}
        </Field>
      ))}
      <p
        role={status === "error" ? "alert" : "status"}
        aria-live="polite"
        className={`text-right text-xs ${status === "error" ? "font-semibold text-destructive" : "text-muted"}`}
      >
        {line}
      </p>
    </div>
  );
}
