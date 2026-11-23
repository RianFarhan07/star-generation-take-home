// Small helpers for reading data in Server Components.
//
// supabase-js infers a row type from the select string. For embedded relations that inference does not
// match how we use the data, so these helpers take the raw result and the page names the shape it expects.

function failure(message: string): Error {
  console.error(`Query failed: ${message}`);
  return new Error(process.env.NODE_ENV === "production" ? "Could not load this page. Please try again." : message);
}

type Result = { data: unknown; error: { message: string } | null };

/** The rows of a query. A failed query is logged on the server; the page error stays generic in production. */
export function rows<T>(result: Result): T[] {
  if (result.error) throw failure(result.error.message);
  return (result.data ?? []) as T[];
}

/** The single row of a query (or null), throwing on an error. */
export function one<T>(result: Result): T | null {
  if (result.error) throw failure(result.error.message);
  return (result.data ?? null) as T | null;
}

/** A PostgREST embed can come back as an object or a one-element array depending on the relation; normalise it. */
export function embedded<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export const LIVE_STATUSES = ["pending_payment", "awaiting_verification", "active"];
