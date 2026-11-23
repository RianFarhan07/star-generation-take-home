"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { callRpc, rupiah, text, type ActionState } from "@/lib/actions";
import { messageForError } from "@/lib/errors";
import { requireRole } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

// Every student action is one database function call; the database checks that the invoice or enrollment is theirs.

export async function enrollInClass(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("student");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("enroll_in_class", {
    p_class_id: text(formData, "classId"),
    p_accept_terms: formData.get("accept") === "on",
  });
  if (error) return { ok: false, error: messageForError(error) };

  const invoice = await supabase.from("invoices").select("id").eq("enrollment_id", data).maybeSingle();
  revalidatePath("/student", "layout");
  redirect(invoice.data ? `/student/invoices/${invoice.data.id}` : "/student/invoices");
}

export async function cancelPendingEnrollment(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("student");
  const result = await callRpc("cancel_pending_enrollment", { p_enrollment_id: text(formData, "enrollmentId") }, ["/student", "/student/classes", "/student/invoices"]);
  if (result?.ok) redirect("/student/classes");
  return result;
}

export async function reportPayment(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("student");
  const amount = rupiah(formData, "amount");
  if (amount === null) return { ok: false, error: "Enter the amount you transferred as whole rupiah, for example 1.800.000." };
  const invoiceId = text(formData, "invoiceId");
  return callRpc(
    "report_payment",
    {
      p_invoice_id: invoiceId,
      p_sender_name: text(formData, "senderName"),
      p_bank: text(formData, "bank"),
      p_transfer_date: text(formData, "transferDate"),
      p_amount: amount,
      p_proof_path: text(formData, "proofPath") || null,
    },
    [`/student/invoices/${invoiceId}`, "/student/invoices", "/student", "/student/classes"],
    "Thank you. The admin will check the bank statement and confirm your payment.",
  );
}

export async function issueRenewal(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("student");
  return callRpc("issue_renewal_invoice", { p_enrollment_id: text(formData, "enrollmentId") }, ["/student", "/student/invoices", `/student/classes/${text(formData, "classId")}`], "Renewal invoice issued. Find it under Invoices.");
}

export async function withdraw(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("student");
  const result = await callRpc(
    "withdraw_enrollment",
    { p_enrollment_id: text(formData, "enrollmentId"), p_cause: "student", p_reason: text(formData, "reason") || "withdrawn by the student" },
    ["/student", "/student/classes", "/student/invoices"],
  );
  if (result?.ok) redirect("/student");
  return result;
}

export async function joinWaitlist(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("student");
  return callRpc("join_waitlist", { p_class_id: text(formData, "classId") }, ["/student/classes"], "You are on the waitlist. We will tell you when a seat opens up.");
}

export async function leaveWaitlist(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("student");
  return callRpc("leave_waitlist", { p_class_id: text(formData, "classId") }, ["/student/classes"]);
}
