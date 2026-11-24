import { Badge } from "@/components/ui/Badge";
import { Card, EmptyState, PageHeader } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Field, Input } from "@/components/ui/Field";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { embedded, rows } from "@/lib/db";
import { formatRupiah } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { formatWib } from "@/lib/time";
import { cancelRefund, markRefunded } from "../actions";

type RefundRow = {
  id: string;
  amount: number;
  cause: string;
  reason: string;
  status: string;
  created_at: string;
  refunded_at: string | null;
  bank_reference: string | null;
  cancel_reason: string | null;
  enrollment: { student: { full_name: string } | { full_name: string }[] | null } | null;
};

const SECTIONS = [
  { status: "pending", title: "Pending", hint: "Repay these in the bank, then mark them as refunded with the bank reference.", empty: "Nothing to repay" },
  { status: "refunded", title: "Refunded", hint: "", empty: "Nothing has been repaid yet" },
  { status: "cancelled", title: "Cancelled", hint: "", empty: "No refund has been cancelled" },
];

export default async function RefundsPage() {
  const supabase = await createClient();
  const refunds = rows<RefundRow>(
    await supabase
      .from("refunds")
      .select("id, amount, cause, reason, status, created_at, refunded_at, bank_reference, cancel_reason, enrollment:enrollments!refunds_enrollment_id_fkey(student:profiles!enrollments_student_id_fkey(full_name))")
      .order("created_at", { ascending: false }),
  );

  return (
    <>
      <PageHeader
        title="Refunds"
        subtitle="Payments are simulated, so the system records what must be repaid and keeps it from being forgotten. A refund is created when the class is closed, for an exception you decide, or for a late transfer on a full class."
      />
      {SECTIONS.map((section) => {
        const list = refunds.filter((r) => r.status === section.status);
        return (
          <section key={section.status} className="mb-6">
            <h2 className="text-sm font-semibold">
              {section.title} <span className="font-normal text-muted">({list.length})</span>
            </h2>
            {section.hint ? <p className="mb-2 text-xs text-muted">{section.hint}</p> : <div className="mb-2" />}
            {list.length === 0 ? (
              <Card>
                <EmptyState title={section.empty} />
              </Card>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Student</Th>
                    <Th>Amount</Th>
                    <Th>Cause</Th>
                    <Th>Reason</Th>
                    <Th>Created</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <Tr key={r.id}>
                      <Td className="font-medium">{embedded(r.enrollment?.student)?.full_name}</Td>
                      <Td className="font-medium">{formatRupiah(r.amount)}</Td>
                      <Td>{r.cause.replace(/_/g, " ")}</Td>
                      <Td className="max-w-xs">{r.reason}</Td>
                      <Td className="text-muted">{formatWib(r.created_at)}</Td>
                      <Td>
                        <Badge status={r.status} />
                        {r.bank_reference ? <div className="text-xs text-muted">Ref. {r.bank_reference}</div> : null}
                        {r.cancel_reason ? <div className="text-xs text-muted">{r.cancel_reason}</div> : null}
                      </Td>
                      <Td>
                        {r.status === "pending" ? (
                          <div className="flex justify-end gap-2">
                            <ConfirmDialog
                              triggerLabel="Mark refunded"
                              title="Mark as refunded"
                              description="Do this after repaying the student in the bank. It cannot be undone."
                              confirmLabel="Mark refunded"
                              action={markRefunded}
                              values={{ refundId: r.id }}
                            >
                              <Field label="Bank reference">
                                <Input name="reference" required />
                              </Field>
                            </ConfirmDialog>
                            <ConfirmDialog
                              triggerLabel="Cancel"
                              triggerVariant="destructive"
                              title="Cancel this refund"
                              confirmLabel="Cancel refund"
                              confirmVariant="destructive"
                              reasonLabel="Reason"
                              action={cancelRefund}
                              values={{ refundId: r.id }}
                            />
                          </div>
                        ) : null}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </section>
        );
      })}
    </>
  );
}
