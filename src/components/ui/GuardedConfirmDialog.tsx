"use client";

import type { ComponentProps } from "react";
import { useAutosave } from "./AutosaveContext";
import { ConfirmDialog } from "./ConfirmDialog";

/** A confirmation dialog whose button waits until every autosaving entry on the page is saved (see AutosaveContext). */
export function GuardedConfirmDialog(props: ComponentProps<typeof ConfirmDialog>) {
  const { unsaved } = useAutosave();
  return <ConfirmDialog {...props} triggerDisabled={props.triggerDisabled || unsaved > 0} />;
}
