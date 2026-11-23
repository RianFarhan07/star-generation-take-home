import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect } from "vitest";

export const PASSWORD = "Password123!";

/** Seed users and class (supabase/seed.sql). Use them only in read-only checks. */
export const SEED = {
  admin: { id: "00000000-0000-0000-0000-000000000001", email: "admin@example.com", name: "Admin", role: "admin" },
  andi: { id: "00000000-0000-0000-0000-000000000002", email: "tutor.andi@example.com", name: "Andi Pratama", role: "tutor" },
  dewi: { id: "00000000-0000-0000-0000-000000000003", email: "tutor.dewi@example.com", name: "Dewi Lestari", role: "tutor" },
  budi: { id: "00000000-0000-0000-0000-000000000011", email: "student.budi@example.com", name: "Budi Santoso", role: "student" },
  sari: { id: "00000000-0000-0000-0000-000000000012", email: "student.sari@example.com", name: "Sari Wulandari", role: "student" },
  citra: { id: "00000000-0000-0000-0000-000000000013", email: "student.citra@example.com", name: "Citra Maharani", role: "student" },
  classId: "00000000-0000-0000-0000-000000000101",
} as const;

export type Role = "admin" | "tutor" | "student";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Run "npx supabase start" and fill .env.local (see .env.example).`);
  return value;
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

/** Signed-in client for one user: this is what every assertion goes through. */
export async function signIn(email: string, password = PASSWORD): Promise<SupabaseClient> {
  const client = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), noSession);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return client;
}

/** Client with no session at all (what an anonymous visitor would use). */
export function anonClient(): SupabaseClient {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), noSession);
}

/** Service-role client. Only for creating users and time-travel fixtures inside tests. */
export function serviceClient(): SupabaseClient {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), noSession);
}

/** Creates a fresh user with a profile and returns it signed in. */
export async function makeUser(role: Role, fullName?: string): Promise<{ id: string; email: string; client: SupabaseClient }> {
  const service = serviceClient();
  const email = `${role}.${randomUUID().slice(0, 8)}@test.example.com`;
  const { data, error } = await service.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  const { error: profileError } = await service
    .from("profiles")
    .insert({ id: data.user.id, full_name: fullName ?? `${role} ${email.slice(role.length + 1, role.length + 9)}`, role });
  if (profileError) throw new Error(`profile insert failed: ${profileError.message}`);
  return { id: data.user.id, email, client: await signIn(email) };
}

/** Asserts a PostgREST/RPC call failed with one of our error codes ("CLASS_FULL: ..."). */
export async function expectCode(call: PromiseLike<{ error: { message: string } | null }>, code: string): Promise<void> {
  const { error } = await call;
  expect(error, `expected ${code} but the call succeeded`).not.toBeNull();
  expect(error!.message.startsWith(`${code}:`), `expected ${code}, got: ${error!.message}`).toBe(true);
}
