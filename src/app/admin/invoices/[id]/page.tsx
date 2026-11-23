import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, DefinitionList, PageHeader } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Field, Input } from "@/components/ui/Field";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { embedded, one, rows } from "@/lib/db";
import { formatRupiah } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { formatWib } from "@/lib/time";
import { adjustInvoiceHours, markPaidOffline, rejectPayment, reversePayment, verifyPayment } from "../../actions";

type InvoiceRow = {
  id: string;
  kind: string;
  hours: number;
  rate_per_hour: number;
  amount: number;
  status: string;
  issued_at: string;
  payment_due_at: string | null;
  paid_at: string | null;
  cancel_reason: string | null;
  enrollment: {
    id: string;
    student: { full_name: string } | { full_name: string }[] | null;
    class: { id: string; name: string } | { id: string; name: string }[] | null;
  } | null;
};
type PaymentRow = {
  id: string;
  kind: string;
  sender_name: string | null;
  bank: string | null;
  transfer_date: string | null;
  amount: number;
  proof_path: string | null;
  reference: string | null;
  no_seat: boolean;
  status: string;
  reported_at: string;
  reject_reason: string | null;
  reversal_reason: string | null;
};
type EventRow = { id: string; action: string; note: string | null; created_at: string };

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const invoice = one<InvoiceRow>(
    await supabase
      .from("invoices")
      .select(
        "id, kind, hours, rate_per_hour, amount, status, issued_at, payment_due_at, paid_at, cancel_reason, " +
          "enrollment:enrollments!invoices_enrollment_id_fkey(id, student:profiles!enrollments_student_id_fkey(full_name), class:classes!enrollments_class_id_fkey(id, name))",
      )
      .eq("id", id)
      .maybeSingle(),
  );
  if (!invoice) notFound();

  const [paymentsResult, eventsResult] = await Promise.all([
    supabase.from("payments").select("*").eq("invoice_id", id).order("reported_at", { ascending: false }),
    supabase.from("invoice_events").select("id, action, note, created_at").eq("invoice_id", id).order("created_at"),
  ]);
  const payments = rows<PaymentRow>(paymentsResult);
  const events = rows<EventRow>(eventsResult);

  // Proof images live in a private bucket: the admin gets a short-lived link.
  const proofUrls = new Map<string, string>();
  for (const p of payments) {
    if (!p.proof_path) continue;
    const { data } = await supabase.storage.from("payment-proofs").createSignedUrl(p.proof_path, 600);
    if (data?.signedUrl) proofUrls.set(p.id, data.signedUrl);
  }

  const student = embedded(invoice.enrollment?.student)?.full_name;
  const cls = embedded(invoice.enrollment?.class);
  const pending = payments.find((p) => p.status === "pending");

  return (
    <>
      <PageHeader
        title={`${invoice.kind === "renewal" ? "Renewal" : "First"} invoice · ${student}`}
        subtitle={
          <>
            {cls ? <Link href={`/admin/classes/${cls.id}`} className="underline-offset-2 hover:underline">{cls.name}</Link> : null}
            {" · "}
            <Link href="/admin/invoices" className="underline-offset-2 hover:underline">All invoices</Link>
          </>
        }
        actions={<Badge status={invoice.status} />}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Invoice" />
          <DefinitionList
            items={[
              { label: "Package", value: `${invoice.hours} h × ${formatRupiah(invoice.rate_per_hour)}` },
              { label: "Amount", value: formatRupiah(invoice.amount) },
              { label: "Issued", value: formatWib(invoice.issued_at) },
              { label: "Payment window ends", value: invoice.payment_due_at ? formatWib(invoice.payment_due_at) : "—" },
              { label: "Paid", value: invoice.paid_at ? formatWib(invoice.paid_at) : "—" },
              { label: "Cancelled because", value: invoice.cancel_reason ?? "—" },
            ]}
          />
        </Card>

        <Card>
          <CardHeader title="What you can do" />
          <div className="flex flex-wrap gap-2 p-4">
            {pending ? (
              <>
                <ConfirmDialog
                  triggerLabel="Verify payment"
                  triggerVariant="primary"
                  title="Verify this payment"
                  description={
                    <>
                      Check the bank statement for {formatRupiah(pending.amount)} from {pending.sender_name}.
                      {pending.no_seat ? " The class filled up after the payment window, so verifying creates a full refund and gives no access." : " Verifying opens the class to the student."}
                    </>
                  }
                  confirmLabel="Verify"
                  action={verifyPayment}
                  values={{ paymentId: pending.id, invoiceId: invoice.id }}
                />
                <ConfirmDialog
                  triggerLabel="Reject"
                  triggerVariant="destructive"
                  title="Reject this payment"
                  description="Use this when the transfer is not on the bank statement. A first invoice is cancelled and the seat is released."
                  confirmLabel="Reject payment"
                  confirmVariant="destructive"
                  reasonLabel="Reason"
                  action={rejectPayment}
                  values={{ paymentId: pending.id, invoiceId: invoice.id }}
                />
              </>
            ) : null}
            {invoice.status === "unpaid" ? (
              <>
                <ConfirmDialog
                  triggerLabel="Mark paid offline"
                  title="Mark as paid (cash or checked transfer)"
                  description="Records an offline payment and opens access at once."
                  confirmLabel="Mark as paid"
                  action={markPaidOffline}
                  values={{ invoiceId: invoice.id }}
                >
                  <Field label="Reference or note">
                    <Input name="reference" required placeholder="Cash receipt 17" />
                  </Field>
                </ConfirmDialog>
                <ConfirmDialog
                  triggerLabel="Adjust hours"
                  title="Change the hours on this invoice"
                  description="For example a student who joins mid-term. The price per hour stays the same."
                  confirmLabel="Save hours"
                  reasonLabel="Reason"
                  action={adjustInvoiceHours}
                  values={{ invoiceId: invoice.id }}
                >
                  <Field label="Hours">
                    <Input name="hours" type="number" min={1} required defaultValue={invoice.hours} />
                  </Field>
                </ConfirmDialog>
              </>
            ) : null}
            {invoice.status === "paid" ? (
              <ConfirmDialog
                triggerLabel="Reverse payment"
                triggerVariant="destructive"
                title="Reverse this payment"
                description="Only for a payment recorded by mistake, and only while none of its hours have been used. A student who has already had lessons is handled with a refund instead."
                confirmLabel="Reverse payment"
                confirmVariant="destructive"
                reasonLabel="Reason"
                action={reversePayment}
                values={{ invoiceId: invoice.id }}
              />
            ) : null}
            {!pending && invoice.status !== "unpaid" && invoice.status !== "paid" ? (
              <p className="text-sm text-muted">No actions for this invoice.</p>
            ) : null}
          </div>
        </Card>
      </div>

      <section className="mt-5">
        <h2 className="mb-2 text-sm font-semibold">Payments reported</h2>
        {payments.length === 0 ? (
          <Card>
            <p className="p-4 text-sm text-muted">No payment has been reported yet.</p>
          </Card>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Reported</Th>
                <Th>From</Th>
                <Th>Amount</Th>
                <Th>Status</Th>
                <Th>Proof</Th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <Tr key={p.id}>
                  <Td>{formatWib(p.reported_at)}</Td>
                  <Td>
                    {p.kind === "offline" ? `Offline · ${p.reference}` : `${p.sender_name} · ${p.bank} · ${p.transfer_date}`}
                    {p.no_seat ? <span className="ml-2"><Badge status="no_seat" /></span> : null}
                    {p.reject_reason ? <div className="text-xs text-muted">Rejected: {p.reject_reason}</div> : null}
                    {p.reversal_reason ? <div className="text-xs text-muted">Reversed: {p.reversal_reason}</div> : null}
                  </Td>
                  <Td>{formatRupiah(p.amount)}</Td>
                  <Td>
                    <Badge status={p.status} />
                  </Td>
                  <Td>
                    {proofUrls.get(p.id) ? (
                      <a href={proofUrls.get(p.id)} target="_blank" rel="noreferrer" className="font-semibold underline-offset-2 hover:underline">
                        View proof
                      </a>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section className="mt-5">
        <h2 className="mb-2 text-sm font-semibold">History</h2>
        <Card>
          <ul className="divide-y divide-cloud text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                <span>
                  <span className="font-medium">{e.action.replace(/_/g, " ")}</span>
                  {e.note ? <span className="text-muted"> — {e.note}</span> : null}
                </span>
                <span className="text-muted">{formatWib(e.created_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </>
  );
}
