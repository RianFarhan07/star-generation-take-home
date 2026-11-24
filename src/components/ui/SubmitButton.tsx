"use client";

import { useContext } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass, type ButtonVariant } from "./Button";
import { FormPendingContext } from "./useActionForm";

/** Submit button that disables itself while its form is being processed, so a double click cannot repeat the action. */
export function SubmitButton({
  children,
  variant = "primary",
  className = "",
}: {
  children: React.ReactNode;
  variant?: ButtonVariant;
  className?: string;
}) {
  // `useFormStatus` covers plain `<form action>`; the context covers forms that submit through useActionForm.
  const formStatus = useFormStatus();
  const formPending = useContext(FormPendingContext);
  const pending = formStatus.pending || formPending;
  return (
    <button type="submit" disabled={pending} className={buttonClass(variant, className)}>
      {pending ? "Working…" : children}
    </button>
  );
}
