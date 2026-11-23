import { badgeFor, type BadgeVariant } from "@/lib/status";

// Solid fills in the brief's colours. The small bold text keeps white-on-green/red readable; the
// contrast trade-off of using the exact brand colours is noted in ARCHITECTURE.md.
const styles: Record<BadgeVariant, string> = {
  success: "bg-success text-white",
  danger: "bg-destructive text-white",
  warning: "bg-gold text-navy",
  neutral: "bg-muted text-white",
};

export function Badge({ status, label }: { status: string; label?: string }) {
  const badge = badgeFor(status);
  return (
    <span className={`inline-block whitespace-nowrap rounded-card px-2 py-0.5 text-xs font-bold ${styles[badge.variant]}`}>
      {label ?? badge.label}
    </span>
  );
}
