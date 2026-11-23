"use client";

import { useFormStatus } from "react-dom";
import { buttonClass, type ButtonVariant } from "./Button";

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
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass(variant, className)}>
      {pending ? "Working…" : children}
    </button>
  );
}
