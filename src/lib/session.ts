import { redirect } from "next/navigation";
import { cache } from "react";
import { homeForRole, type Role } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type SessionProfile = { userId: string; fullName: string; role: Role };

/** The signed-in user and their profile, or null. Cached per request. */
export const getSessionProfile = cache(async (): Promise<SessionProfile | null> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data: profile } = await supabase.from("profiles").select("full_name, role").eq("id", auth.user.id).maybeSingle();
  if (!profile) return null;
  return { userId: auth.user.id, fullName: profile.full_name as string, role: profile.role as Role };
});

/** For layouts and pages of one role: wrong or missing session -> redirect to where the user belongs. */
export async function requireRole(role: Role): Promise<SessionProfile> {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (session.role !== role) redirect(homeForRole(session.role));
  return session;
}
