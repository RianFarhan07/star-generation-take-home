import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SEED, serviceClient, signIn } from "./clients";

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

/** Student enrolls (accepting the no-refund terms) and gets the initial invoice. */
export async function enroll(student: SupabaseClient, classId: string): Promise<{ enrollmentId: string; invoiceId: string }> {
  const { data, error } = await student.rpc("enroll_in_class", { p_class_id: classId, p_accept_terms: true });
  if (error) throw new Error(`enroll_in_class failed: ${error.message}`);
  const enrollmentId = data as string;
  const invoice = await student.from("invoices").select("id").eq("enrollment_id", enrollmentId).single();
  if (invoice.error) throw new Error(`reading the invoice failed: ${invoice.error.message}`);
  return { enrollmentId, invoiceId: invoice.data.id as string };
}

/** The student reports a bank transfer for the invoice (full amount) and returns the payment id. */
export async function reportPayment(student: SupabaseClient, invoiceId: string, extra: { proofPath?: string } = {}): Promise<string> {
  const invoice = await student.from("invoices").select("amount").eq("id", invoiceId).single();
  if (invoice.error) throw new Error(`reading the invoice failed: ${invoice.error.message}`);
  const { data, error } = await student.rpc("report_payment", {
    p_invoice_id: invoiceId,
    p_sender_name: "Test Sender",
    p_bank: "BCA",
    p_transfer_date: new Date().toISOString().slice(0, 10),
    p_amount: invoice.data.amount,
    p_proof_path: extra.proofPath ?? null,
  });
  if (error) throw new Error(`report_payment failed: ${error.message}`);
  return data as string;
}

/** Enroll, report the transfer and have the admin verify it: the student ends up active and paid. */
export async function enrollAndPay(
  student: SupabaseClient,
  admin: SupabaseClient,
  classId: string,
): Promise<{ enrollmentId: string; invoiceId: string; paymentId: string }> {
  const { enrollmentId, invoiceId } = await enroll(student, classId);
  const paymentId = await reportPayment(student, invoiceId);
  const { error } = await admin.rpc("verify_payment", { p_payment_id: paymentId });
  if (error) throw new Error(`verify_payment failed: ${error.message}`);
  return { enrollmentId, invoiceId, paymentId };
}

/**
 * Time travel for tests only: pretend the student paid and was activated at `to` (service role).
 * Needed because lessons only count after activation and entries only exist for lessons that have ended.
 */
export async function backdateActivation(enrollmentId: string, to: Date): Promise<void> {
  const service = serviceClient();
  const enrollment = await service.from("enrollments").update({ activated_at: to.toISOString() }).eq("id", enrollmentId);
  if (enrollment.error) throw new Error(`backdate enrollment failed: ${enrollment.error.message}`);
  const invoices = await service
    .from("invoices")
    .update({ paid_at: to.toISOString() })
    .eq("enrollment_id", enrollmentId)
    .eq("status", "paid");
  if (invoices.error) throw new Error(`backdate invoices failed: ${invoices.error.message}`);
}

/** Schedules a lesson of `minutes` (default 90) through create_lesson and returns its id. */
export async function lesson(caller: SupabaseClient, classId: string, start: Date, minutes = 90): Promise<string> {
  const { data, error } = await caller.rpc("create_lesson", {
    p_class_id: classId,
    p_starts_at: start.toISOString(),
    p_ends_at: new Date(start.getTime() + minutes * 60_000).toISOString(),
  });
  if (error) throw new Error(`create_lesson failed: ${error.message}`);
  return data as string;
}

/** Runs the scheduled jobs as if it were `now` (service role), only for the given enrollments. */
export async function runJobs(now: Date, only: string[]): Promise<{ expired: number; renewals: number; released: number }> {
  const { data, error } = await serviceClient().rpc("run_scheduled_jobs", { p_now: now.toISOString(), p_only: only });
  if (error) throw new Error(`run_scheduled_jobs failed: ${error.message}`);
  return data as { expired: number; renewals: number; released: number };
}

/** Runs the scheduled jobs as if it were `now`, limited to the waitlists of the given classes (service role). */
export async function runClassJobs(now: Date, classIds: string[]): Promise<Record<string, number>> {
  const { data, error } = await serviceClient().rpc("run_scheduled_jobs", { p_now: now.toISOString(), p_classes: classIds });
  if (error) throw new Error(`run_scheduled_jobs failed: ${error.message}`);
  return data as Record<string, number>;
}

/** A moment `hours` from now. */
export function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 3600_000);
}

/**
 * The previous WIB month, for tests about ended lessons: every day of it is in the past and in one month,
 * whatever day the suite runs on. `firstDay` is "YYYY-MM-01"; `at(day, hourWib)` is that day at hourWib WIB.
 */
export function previousMonth(): { firstDay: string; at: (day: number, hourWib?: number) => Date } {
  const wibNow = new Date(Date.now() + 7 * 3600_000);
  const year = wibNow.getUTCFullYear();
  const month = wibNow.getUTCMonth() - 1; // 0-based, may be -1 (JS normalises the year)
  const first = new Date(Date.UTC(year, month, 1));
  const firstDay = `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}-01`;
  return { firstDay, at: (day, hourWib = 16) => new Date(Date.UTC(year, month, day, hourWib - 7, 0, 0)) };
}

/** A moment `days` from now at `hourWib`:00 WIB (negative days = the past). */
export function daysFromNow(days: number, hourWib = 16): Date {
  const wibNow = new Date(Date.now() + 7 * 3600_000);
  return new Date(Date.UTC(wibNow.getUTCFullYear(), wibNow.getUTCMonth(), wibNow.getUTCDate() + days, hourWib - 7, 0, 0));
}
