import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { Card, EmptyState, PageHeader } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { embedded, rows } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { formatHours } from "@/lib/time";
import { exceptionRefund, issueRenewal, withdrawEnrollment } from "../actions";

type EnrollmentRow = {
  id: string;
  status: string;
  end_cause: string | null;
  student: { full_name: string } | { full_name: string }[] | null;
  class: { name: string } | { name: string }[] | null;
};
type Balance = { enrollment_id: string; purchased_minutes: number; used_minutes: number; remaining_minutes: number; low_hours: boolean; out_of_hours: boolean };

export default async function StudentsPage() {
  const supabase = await createClient();
  const [enrollments, overview, openInvoices] = await Promise.all([
    supabase
      .from("enrollments")
      .select("id, status, end_cause, student:profiles!enrollments_student_id_fkey(full_name), class:classes!enrollments_class_id_fkey(name)")
      .order("created_at", { ascending: false }),
    supabase.rpc("admin_overview"),
    supabase.from("invoices").select("id, enrollment_id, status").in("status", ["unpaid", "awaiting_verification"]),
  ]);
  if (overview.error) throw new Error(overview.error.message);
  // An enrollment with an open invoice cannot get a renewal invoice: link to that invoice instead of the button.
  const openInvoiceOf = new Map(rows<{ id: string; enrollment_id: string; status: string }>(openInvoices).map((i) => [i.enrollment_id, i]));
  const balances = new Map<string, Balance>((overview.data.balances as Balance[]).map((b) => [b.enrollment_id, b]));
  const list = rows<EnrollmentRow>(enrollments).sort((a, b) =>
    (embedded(a.student)?.full_name ?? "").localeCompare(embedded(b.student)?.full_name ?? ""),
  );

  return (
    <>
      <PageHeader title="Students" subtitle="Every enrollment with its hours. Hours are replayed from payments and lessons, never stored." />
      {list.length === 0 ? (
        <Card>
          <EmptyState title="No enrollments yet" />
        </Card>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Student</Th>
              <Th>Class</Th>
              <Th>Status</Th>
              <Th>Bought</Th>
              <Th>Used</Th>
              <Th>Left</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {list.map((e) => {
              const b = balances.get(e.id);
              return (
                <Tr key={e.id}>
                  <Td className="font-medium">{embedded(e.student)?.full_name}</Td>
                  <Td>{embedded(e.class)?.name}</Td>
                  <Td>
                    <Badge status={e.status} />
                    {e.end_cause ? <span className="ml-2 text-xs text-muted">{e.end_cause.replace("_", " ")}</span> : null}
                  </Td>
                  <Td>{b ? formatHours(b.purchased_minutes) : "—"}</Td>
                  <Td>{b ? formatHours(b.used_minutes) : "—"}</Td>
                  <Td>
                    {b ? (
                      <span className="inline-flex items-center gap-2">
                        {formatHours(b.remaining_minutes)}
                        {b.out_of_hours ? <Badge status="out_of_hours" /> : b.low_hours ? <Badge status="low_hours" /> : null}
                      </span>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap justify-end gap-2">
                      {e.status === "active" ? (
                        <>
                          {openInvoiceOf.has(e.id) ? (
                            <Link
                              href={`/admin/invoices/${openInvoiceOf.get(e.id)!.id}`}
                              className={buttonClass("secondary", "px-2.5 py-1 text-xs")}
                            >
                              Open invoice ({openInvoiceOf.get(e.id)!.status === "awaiting_verification" ? "to verify" : "unpaid"})
                            </Link>
                          ) : (
                            <ConfirmDialog
                              triggerLabel="Renewal"
                              title="Issue a renewal invoice"
                              description="A new package invoice at the current student rate. Not possible while another invoice is open."
                              confirmLabel="Issue invoice"
                              action={issueRenewal}
                              values={{ enrollmentId: e.id }}
                            />
                          )}
                          <ConfirmDialog
                            triggerLabel="Withdraw"
                            triggerVariant="destructive"
                            title="End this enrollment"
                            description="The seat is freed and open invoices are cancelled. A student who leaves gets no refund; if the business ends it (class closed, tutor unavailable) the unused hours are refunded at the rate of the invoices they belong to."
                            confirmLabel="End enrollment"
                            confirmVariant="destructive"
                            reasonLabel="Reason"
                            action={withdrawEnrollment}
                            values={{ enrollmentId: e.id }}
                          >
                            <Field label="Who ended it?">
                              <Select name="cause" defaultValue="business">
                                <option value="business">The business (refund unused hours)</option>
                                <option value="student">The student (no refund)</option>
                              </Select>
                            </Field>
                          </ConfirmDialog>
                        </>
                      ) : null}
                      <ConfirmDialog
                        triggerLabel="Refund"
                        title="Record an exception refund"
                        description="For cases the rules do not cover, such as a family moving away. The refund appears as pending on the Refunds page until it is repaid in the bank."
                        confirmLabel="Create refund"
                        reasonLabel="Reason"
                        action={exceptionRefund}
                        values={{ enrollmentId: e.id }}
                      >
                        <Field label="Amount (Rp)">
                          <Input name="amount" inputMode="numeric" required placeholder="500.000" />
                        </Field>
                      </ConfirmDialog>
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
