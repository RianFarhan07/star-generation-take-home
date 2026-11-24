"use client";

import { useAutosave } from "@/components/ui/AutosaveContext";
import { SubmitButton } from "@/components/ui/SubmitButton";

/** "Finalise and submit": enabled only when the month is complete AND every entry on the page is saved. */
export function FinaliseButton({ canSubmit }: { canSubmit: boolean }) {
  const { unsaved, saving } = useAutosave();
  return (
    <div className="flex flex-col items-end gap-1">
      <SubmitButton disabled={!canSubmit || unsaved > 0}>Finalise and submit</SubmitButton>
      {unsaved > 0 ? <p className="text-xs text-muted">{saving ? "Saving your entries…" : "Some entries are not saved yet."}</p> : null}
    </div>
  );
}
