import { revalidatePath } from "next/cache";
import { messageForError } from "@/lib/errors";
import { parseRupiah } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

// Shared helpers for the Server Actions. Every action is a thin wrapper around one database function:
// the rule lives in the database, the action only passes the form values on and shows the result.

/** A link shown next to an error, for example to the invoice that is already open. */
export type ActionLink = { href: string; label: string };

export type ActionState = { ok: true; message?: string } | { ok: false; error: string; link?: ActionLink } | null;

/** The open (unpaid or awaiting verification) invoice of an enrollment, as a link for the given area. */
export async function openInvoiceLink(enrollmentId: string, area: "admin" | "student"): Promise<ActionLink | undefined> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select("id")
    .eq("enrollment_id", enrollmentId)
    .in("status", ["unpaid", "awaiting_verification"])
    .limit(1)
    .maybeSingle();
  return data ? { href: `/${area}/invoices/${data.id}`, label: "Open that invoice" } : undefined;
}

/** Calls a database function as the signed-in user and returns a result the form can show. */
export async function callRpc(
  fn: string,
  args: Record<string, unknown>,
  paths: string[],
  message?: string | ((result: unknown) => string),
): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, error: messageForError(error) };
  paths.forEach((path) => revalidatePath(path));
  return { ok: true, message: typeof message === "function" ? message(data) : message };
}

/** Like callRpc but returns the function's result too (for actions that redirect to what was just created). */
export async function callRpcResult<T>(
  fn: string,
  args: Record<string, unknown>,
  paths: string[],
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, error: messageForError(error) };
  paths.forEach((path) => revalidatePath(path));
  return { ok: true, data: data as T };
}

export function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function int(formData: FormData, key: string): number | null {
  const value = text(formData, key);
  return /^\d+$/.test(value) ? Number(value) : null;
}

/** A rupiah field typed by a person ("150.000", "Rp150,000") -> whole rupiah, or null. */
export function rupiah(formData: FormData, key: string): number | null {
  return parseRupiah(text(formData, key));
}
