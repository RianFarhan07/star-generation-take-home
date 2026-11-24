import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/auth";

/** How many rows of a table have the given status (head request: only the count travels). */
async function count(supabase: SupabaseClient, table: "invoices" | "logbooks" | "refunds", status: string): Promise<number> {
  const { count: total } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("status", status);
  return total ?? 0;
}

/**
 * Numbers shown next to sidebar items, keyed by the item's href: things waiting for the person to act.
 * For the admin: payments to verify, logbooks to review and refunds to repay. The database already limits
 * what each role can count, so a count is never more than what that person may see.
 */
export async function navBadges(supabase: SupabaseClient, role: Role): Promise<Record<string, number>> {
  if (role !== "admin") return {};
  const [invoices, logbooks, refunds] = await Promise.all([
    count(supabase, "invoices", "awaiting_verification"),
    count(supabase, "logbooks", "submitted"),
    count(supabase, "refunds", "pending"),
  ]);
  return { "/admin/invoices": invoices, "/admin/logbooks": logbooks, "/admin/refunds": refunds };
}
