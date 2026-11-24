"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ActionState } from "@/lib/actions";
import { useActionForm } from "./useActionForm";

/**
 * A form wired to a Server Action. Shows the action's error or success message under the fields, keeps
 * what was typed when the action fails, and clears the form after a success when `resetOnSuccess` is set.
 * A success message disappears as soon as the person starts typing again; an error stays until the next try.
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
  const { state, formAction, formRef, onSubmit } = useActionForm(action);
  const [dismissed, setDismissed] = useState<ActionState>(null);

  useEffect(() => {
    if (state?.ok && resetOnSuccess) formRef.current?.reset();
  }, [state, resetOnSuccess, formRef]);

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} onInput={() => setDismissed(state)} className={className}>
      {children}
      {state && !state.ok ? (
        <p role="alert" className="mt-3 rounded-card bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
          {state.link ? (
            <>
              {" "}
              <Link href={state.link.href} className="font-semibold underline underline-offset-2">
                {state.link.label}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {state?.ok && state.message && state !== dismissed ? (
        <p role="status" className="mt-3 rounded-card bg-success/10 px-3 py-2 text-sm font-medium text-navy">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
