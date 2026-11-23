import { createBrowserClient } from "@supabase/ssr";

/** Browser client. Used only to upload a payment proof image to the student's own storage folder. */
export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
