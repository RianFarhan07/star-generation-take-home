// Small helpers for reading data in Server Components.
//
// supabase-js infers a row type from the select string. For embedded relations that inference does not
// match how we use the data, so these helpers take the raw result and the page names the shape it expects.

type Result = { data: unknown; error: { message: string } | null };

/** The rows of a query, or a thrown error that names what went wrong (shown by Next's error page). */
export function rows<T>(result: Result): T[] {
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as T[];
}

/** The single row of a query (or null), throwing on an error. */
export function one<T>(result: Result): T | null {
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? null) as T | null;
}

/** A PostgREST embed can come back as an object or a one-element array depending on the relation; normalise it. */
export function embedded<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export const LIVE_STATUSES = ["pending_payment", "awaiting_verification", "active"];
