"use server";

import { requireRole } from "@/lib/session";
import { redirect } from "next/navigation";
import { callRpc, callRpcResult, int, openInvoiceLink, rupiah, text, type ActionState } from "@/lib/actions";
import { messageForCode } from "@/lib/errors";
import { wibInputToUtcIso } from "@/lib/time";

// Every admin action is one database function call; the database checks that the caller is an admin.

const need = (message: string): ActionState => ({ ok: false, error: message });

// ----------------------------------------------------------------------------- classes

export async function createClass(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  const studentRate = rupiah(formData, "studentRate");
  const tutorRate = rupiah(formData, "tutorRate");
  const capacity = int(formData, "capacity");
  const packageHours = int(formData, "packageHours");
  if (studentRate === null || tutorRate === null) return need("Enter both rates as whole rupiah amounts, for example 150.000.");
  if (capacity === null || packageHours === null) return need("Capacity and package hours must be whole numbers.");

  const result = await callRpcResult<string>(
    "create_class",
    {
      p_name: text(formData, "name"),
      p_description: text(formData, "description"),
      p_tutor_id: text(formData, "tutorId"),
      p_capacity: capacity,
      p_package_hours: packageHours,
      p_student_rate: studentRate,
      p_tutor_rate: tutorRate,
    },
    ["/admin/classes"],
  );
  if (!result.ok) return { ok: false, error: result.error };
  redirect(`/admin/classes/${result.data}`);
}

export async function updateClassDetails(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  const packageHours = int(formData, "packageHours");
  if (packageHours === null) return need("Package hours must be a whole number.");
  const id = text(formData, "classId");
  return callRpc(
    "update_class_details",
    { p_class_id: id, p_name: text(formData, "name"), p_description: text(formData, "description"), p_package_hours: packageHours },
    [`/admin/classes/${id}`, "/admin/classes"],
    "Class details saved.",
  );
}

export async function setClassRates(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  const studentRate = rupiah(formData, "studentRate");
  const tutorRate = rupiah(formData, "tutorRate");
  if (studentRate === null || tutorRate === null) return need("Enter both rates as whole rupiah amounts, for example 150.000.");
  const id = text(formData, "classId");
  return callRpc(
    "set_class_rates",
    { p_class_id: id, p_student_rate: studentRate, p_tutor_rate: tutorRate },
    [`/admin/classes/${id}`, "/admin/classes"],
    "New rates saved. They apply to new invoices and to lessons that start from now on.",
  );
}

export async function setClassCapacity(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  const capacity = int(formData, "capacity");
  if (capacity === null) return need("Capacity must be a whole number.");
  const id = text(formData, "classId");
  return callRpc("set_class_capacity", { p_class_id: id, p_capacity: capacity }, [`/admin/classes/${id}`, "/admin/classes"], "Capacity saved.");
}

export async function changeClassTutor(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  const id = text(formData, "classId");
  return callRpc(
    "change_class_tutor",
    { p_class_id: id, p_new_tutor_id: text(formData, "tutorId") },
    [`/admin/classes/${id}`, "/admin/classes"],
    (moved) => `Tutor changed. ${moved as number} upcoming lesson(s) moved to the new tutor.`,
  );
}

// ----------------------------------------------------------------------------- lessons

export async function addLesson(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  const id = text(formData, "classId");
  let startsAt: string;
  let endsAt: string;
  try {
    startsAt = wibInputToUtcIso(text(formData, "date"), text(formData, "start"));
    endsAt = wibInputToUtcIso(text(formData, "date"), text(formData, "end"));
  } catch {
    return need("Enter a valid date and times.");
  }
  return callRpc("create_lesson", { p_class_id: id, p_starts_at: startsAt, p_ends_at: endsAt }, [`/admin/classes/${id}`], "Lesson added.");
}

export async function cancelLesson(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  const id = text(formData, "classId");
  return callRpc("cancel_lesson", { p_lesson_id: text(formData, "lessonId"), p_reason: text(formData, "reason") }, [`/admin/classes/${id}`]);
}

// ----------------------------------------------------------------------------- students and enrollments

export async function withdrawEnrollment(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  return callRpc(
    "withdraw_enrollment",
    { p_enrollment_id: text(formData, "enrollmentId"), p_cause: text(formData, "cause"), p_reason: text(formData, "reason") },
    ["/admin/students", "/admin/refunds", "/admin/classes"],
  );
}

export async function exceptionRefund(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  const amount = rupiah(formData, "amount");
  if (amount === null) return need("Enter the refund amount as whole rupiah, for example 500.000.");
  return callRpc(
    "create_exception_refund",
    { p_enrollment_id: text(formData, "enrollmentId"), p_amount: amount, p_reason: text(formData, "reason") },
    ["/admin/students", "/admin/refunds"],
  );
}

export async function issueRenewal(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  const enrollmentId = text(formData, "enrollmentId");
  // When an invoice is already open, say so and point at it instead of failing blindly (the database refuses too).
  const open = await openInvoiceLink(enrollmentId, "admin");
  if (open) return { ok: false, error: messageForCode("RENEWAL_OPEN"), link: open };
  return callRpc("issue_renewal_invoice", { p_enrollment_id: enrollmentId }, ["/admin/students", "/admin/invoices"], "Renewal invoice issued.");
}

// ----------------------------------------------------------------------------- invoices and payments

const invoicePaths = (invoiceId: string) => ["/admin/invoices", `/admin/invoices/${invoiceId}`, "/admin/students", "/admin"];

export async function verifyPayment(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  return callRpc("verify_payment", { p_payment_id: text(formData, "paymentId") }, invoicePaths(text(formData, "invoiceId")), "Payment verified.");
}

export async function rejectPayment(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  return callRpc(
    "reject_payment",
    { p_payment_id: text(formData, "paymentId"), p_reason: text(formData, "reason") },
    invoicePaths(text(formData, "invoiceId")),
  );
}

export async function markPaidOffline(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  return callRpc(
    "mark_paid_offline",
    { p_invoice_id: text(formData, "invoiceId"), p_reference: text(formData, "reference") },
    invoicePaths(text(formData, "invoiceId")),
    "Invoice marked as paid.",
  );
}

export async function reversePayment(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  return callRpc(
    "reverse_payment",
    { p_invoice_id: text(formData, "invoiceId"), p_reason: text(formData, "reason") },
    invoicePaths(text(formData, "invoiceId")),
  );
}

export async function adjustInvoiceHours(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  const hours = int(formData, "hours");
  if (hours === null) return need("Hours must be a whole number.");
  return callRpc(
    "adjust_invoice_hours",
    { p_invoice_id: text(formData, "invoiceId"), p_hours: hours, p_reason: text(formData, "reason") },
    invoicePaths(text(formData, "invoiceId")),
  );
}

// ----------------------------------------------------------------------------- refunds

export async function markRefunded(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  return callRpc("mark_refunded", { p_refund_id: text(formData, "refundId"), p_bank_reference: text(formData, "reference") }, ["/admin/refunds", "/admin"]);
}

export async function cancelRefund(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  return callRpc("cancel_refund", { p_refund_id: text(formData, "refundId"), p_reason: text(formData, "reason") }, ["/admin/refunds", "/admin"]);
}

// ----------------------------------------------------------------------------- logbooks

const logbookPaths = (logbookId: string) => ["/admin/logbooks", `/admin/logbooks/${logbookId}`, "/admin"];

export async function approveLogbook(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  const id = text(formData, "logbookId");
  return callRpc("approve_logbook", { p_logbook_id: id }, logbookPaths(id), (created) =>
    created === 0 ? "Already approved. Nothing was added." : `Logbook approved. ${created as number} earning(s) recorded.`,
  );
}

export async function requestLogbookChanges(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  const id = text(formData, "logbookId");
  const flagged = formData.getAll("flagged").map(String);
  return callRpc(
    "request_logbook_changes",
    { p_logbook_id: id, p_comment: text(formData, "reason"), p_flagged_entry_ids: flagged },
    logbookPaths(id),
    "Sent back to the tutor.",
  );
}

export async function editLogbookEntry(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("admin");
  const id = text(formData, "logbookId");
  return callRpc(
    "admin_edit_entry",
    {
      p_entry_id: text(formData, "entryId"),
      p_topic: text(formData, "topic"),
      p_activities: text(formData, "activities"),
      p_observation: text(formData, "observation"),
      p_recommendation: text(formData, "recommendation"),
    },
    logbookPaths(id),
    "Entry updated. The tutor's original text is kept.",
  );
}
