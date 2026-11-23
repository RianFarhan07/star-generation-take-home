import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";

export type ButtonVariant = "primary" | "secondary" | "destructive";

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-card px-3.5 py-2 text-sm font-semibold transition-colors " +
  "disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold";

// Primary = Navy filled. Secondary = white with a Cloud border. Destructive = white with a red border.
const variants: Record<ButtonVariant, string> = {
  primary: "bg-navy text-white hover:bg-navy/90",
  secondary: "border border-cloud bg-white text-navy hover:bg-field",
  destructive: "border border-destructive bg-white text-destructive hover:bg-destructive/5",
};

export function buttonClass(variant: ButtonVariant = "primary", extra = ""): string {
  return `${base} ${variants[variant]} ${extra}`.trim();
}

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button className={buttonClass(variant, className)} {...props} />;
}

/** A link that looks like a button. */
export function LinkButton({ variant = "secondary", className = "", ...props }: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link className={buttonClass(variant, className)} {...props} />;
}
