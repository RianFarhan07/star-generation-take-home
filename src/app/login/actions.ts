"use server";

import { redirect } from "next/navigation";
import { homeForRole, type Role } from "@/lib/auth";
import { text, type ActionState } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";

export async function signIn(_state: ActionState, formData: FormData): Promise<ActionState> {
  const email = text(formData, "email");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { ok: false, error: "Enter your email and password." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { ok: false, error: "Incorrect email or password." };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  if (!profile) return { ok: false, error: "This account has no profile yet. Ask an admin." };
  redirect(homeForRole(profile.role as Role));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
