// One place that decides how a status looks. Statuses come straight from the database enums.

export type BadgeVariant = "success" | "danger" | "warning" | "neutral";

const SUCCESS = new Set(["paid", "approved", "active", "refunded", "verified", "deducted", "scheduled_ok"]);
const DANGER = new Set(["overdue", "rejected", "out_of_hours", "no_seat"]);
const WARNING = new Set([
  "awaiting_verification", "submitted", "low_hours", "pending", "pending_payment", "unpaid",
  "changes_requested", "taught",
]);

function humanize(status: string): string {
  const text = status.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function badgeFor(status: string): { variant: BadgeVariant; label: string } {
  const variant: BadgeVariant = SUCCESS.has(status)
    ? "success"
    : DANGER.has(status)
      ? "danger"
      : WARNING.has(status)
        ? "warning"
        : "neutral";
  return { variant, label: humanize(status) };
}
