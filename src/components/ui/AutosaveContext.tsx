"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

/** Where an autosaving entry stands: everything is in the database, or something is still on its way. */
export type AutosaveStatus = "saved" | "dirty" | "saving" | "incomplete" | "error";

type AutosaveValue = {
  /** An entry reports its status here (its id is the key). */
  report: (id: string, status: AutosaveStatus) => void;
  /** How many entries have something that is not in the database yet. */
  unsaved: number;
  /** True while at least one save is running. */
  saving: boolean;
};

const AutosaveContext = createContext<AutosaveValue>({ report: () => {}, unsaved: 0, saving: false });

/**
 * Wraps a page that has autosaving entries and the buttons that must wait for them (Finalise, Approve):
 * a button must not act on a month while some text is still unsaved, or that text would be left behind.
 */
export function AutosaveProvider({ children }: { children: React.ReactNode }) {
  const [statuses, setStatuses] = useState<Record<string, AutosaveStatus>>({});
  const report = useCallback((id: string, status: AutosaveStatus) => {
    setStatuses((previous) => (previous[id] === status ? previous : { ...previous, [id]: status }));
  }, []);
  const value = useMemo<AutosaveValue>(() => {
    const all = Object.values(statuses);
    return { report, unsaved: all.filter((s) => s !== "saved").length, saving: all.includes("saving") };
  }, [report, statuses]);
  return <AutosaveContext.Provider value={value}>{children}</AutosaveContext.Provider>;
}

export function useAutosave(): AutosaveValue {
  return useContext(AutosaveContext);
}
