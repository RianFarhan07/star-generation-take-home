"use client";

import { createContext, useActionState, useTransition } from "react";
import type { ActionState } from "@/lib/actions";

/** True while the surrounding form's Server Action is running. SubmitButton reads it to disable itself. */
export const FormPendingContext = createContext(false);

/**
 * Runs a Server Action from a form without letting React clear the fields afterwards.
 *
 * React 19 resets an uncontrolled form after every `<form action={...}>` call, even when the action
 * returned an error, so a rejected entry would wipe what the person had just typed. Sending the data
 * from `onSubmit` instead keeps the fields as they are; success handlers reset the form explicitly.
 */
export function useActionForm(action: (state: ActionState, formData: FormData) => Promise<ActionState>) {
  const [state, dispatch] = useActionState(action, null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  }

  return { state, pending, onSubmit };
}
