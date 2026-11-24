"use client";

import { useActionState, useLayoutEffect, useRef } from "react";
import type { ActionState } from "@/lib/actions";

/** Writes the submitted values back into the form's visible fields (hidden inputs and files are left alone). */
function restoreFields(form: HTMLFormElement, typed: FormData) {
  for (const element of Array.from(form.elements)) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) continue;
    if (!element.name || element.type === "hidden" || element.type === "file" || element.type === "submit") continue;
    if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
      element.checked = typed.getAll(element.name).includes(element.value);
    } else {
      element.value = String(typed.get(element.name) ?? "");
    }
  }
}

/**
 * Wires a form to a Server Action and keeps what was typed when the action fails.
 *
 * React 19 clears an uncontrolled form after every form action, even one that returned an error, so a
 * rejected entry would wipe the person's input. The form keeps its real `action` (it still works before the
 * page has hydrated, and `useFormStatus` still drives the submit button); we only remember the submitted
 * values and write them back when the action reports an error.
 */
export function useActionForm(action: (state: ActionState, formData: FormData) => Promise<ActionState>) {
  const [state, formAction] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const typed = useRef<FormData | null>(null);

  // Does not call preventDefault, so React still runs the form action as usual.
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    typed.current = new FormData(event.currentTarget);
  }

  // Runs after React has reset the form for this action and before the browser paints.
  useLayoutEffect(() => {
    if (state && !state.ok && formRef.current && typed.current) restoreFields(formRef.current, typed.current);
  }, [state]);

  return { state, formAction, formRef, onSubmit };
}
