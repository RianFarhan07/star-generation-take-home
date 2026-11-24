"use client";

import { useEffect, useRef } from "react";
import type { ActionState } from "@/lib/actions";
import { FormPendingContext, useActionForm } from "./useActionForm";

/**
 * A form wired to a Server Action. Shows the action's error or success message under the fields, keeps
 * what was typed when the action fails, and clears the form after a success when `resetOnSuccess` is set.
 */
export function ActionForm({
  action,
  children,
  className = "",
  resetOnSuccess = false,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const { state, pending, onSubmit } = useActionForm(action);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form ref={ref} onSubmit={onSubmit} className={className}>
      <FormPendingContext value={pending}>{children}</FormPendingContext>
      {state && !state.ok ? (
        <p role="alert" className="mt-3 rounded-card bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state?.ok && state.message ? (
        <p role="status" className="mt-3 rounded-card bg-success/10 px-3 py-2 text-sm font-medium text-navy">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
