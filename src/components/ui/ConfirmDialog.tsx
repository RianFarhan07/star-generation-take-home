"use client";

import { useActionState, useEffect, useRef } from "react";
import type { ActionState } from "@/lib/actions";
import { buttonClass, type ButtonVariant } from "./Button";
import { Field, Textarea } from "./Field";
import { SubmitButton } from "./SubmitButton";

/**
 * A button that opens a confirmation dialog before running a Server Action. With `reasonLabel` the dialog
 * also asks for a required reason (sent as the "reason" field). Hidden values (ids) are passed in `values`.
 */
export function ConfirmDialog({
  triggerLabel,
  triggerVariant = "secondary",
  title,
  description,
  confirmLabel,
  confirmVariant = "primary",
  action,
  values = {},
  reasonLabel,
  children,
}: {
  triggerLabel: string;
  triggerVariant?: ButtonVariant;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  values?: Record<string, string>;
  reasonLabel?: string;
  children?: React.ReactNode; // extra fields inside the dialog
}) {
  const [state, formAction] = useActionState(action, null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (state?.ok) dialog.current?.close();
  }, [state]);

  return (
    <>
      <button type="button" className={buttonClass(triggerVariant, "px-2.5 py-1 text-xs")} onClick={() => dialog.current?.showModal()}>
        {triggerLabel}
      </button>
      <dialog
        ref={dialog}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-card border border-cloud bg-white p-0 text-navy shadow-lg backdrop:bg-navy/40"
      >
        <form action={formAction} className="space-y-4 p-5">
          <h2 className="text-base font-bold">{title}</h2>
          {description ? <div className="text-sm text-muted">{description}</div> : null}
          {Object.entries(values).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          {children}
          {reasonLabel ? (
            <Field label={reasonLabel}>
              <Textarea name="reason" required />
            </Field>
          ) : null}
          {state && !state.ok ? (
            <p role="alert" className="rounded-card bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {state.error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass("secondary")} onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <SubmitButton variant={confirmVariant}>{confirmLabel}</SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
