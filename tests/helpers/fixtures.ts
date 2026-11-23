import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SEED, signIn } from "./clients";

/** Signed-in seed admin (used to call admin functions in tests; the seed admin owns no demo data we change). */
export function adminClient(): Promise<SupabaseClient> {
  return signIn(SEED.admin.email);
}

export type ClassOptions = {
  tutorId: string;
  capacity?: number;
  packageHours?: number;
  studentRate?: number;
  tutorRate?: number;
};

/** Creates a fresh class through the real admin function. Defaults: capacity 2, 12 h, Rp150,000 / Rp100,000. */
export async function createClass(admin: SupabaseClient, o: ClassOptions): Promise<string> {
  const { data, error } = await admin.rpc("create_class", {
    p_name: `Test class ${randomUUID().slice(0, 8)}`,
    p_description: "Created by the test suite",
    p_tutor_id: o.tutorId,
    p_capacity: o.capacity ?? 2,
    p_package_hours: o.packageHours ?? 12,
    p_student_rate: o.studentRate ?? 150000,
    p_tutor_rate: o.tutorRate ?? 100000,
  });
  if (error) throw new Error(`create_class failed: ${error.message}`);
  return data as string;
}

/** A moment `days` from now at `hourWib`:00 WIB (negative days = the past). */
export function daysFromNow(days: number, hourWib = 16): Date {
  const wibNow = new Date(Date.now() + 7 * 3600_000);
  return new Date(Date.UTC(wibNow.getUTCFullYear(), wibNow.getUTCMonth(), wibNow.getUTCDate() + days, hourWib - 7, 0, 0));
}
