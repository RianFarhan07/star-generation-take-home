import Link from "next/link";
import { notFound } from "next/navigation";
import { ProofUpload } from "@/components/student/ProofUpload";
import { ActionForm } from "@/components/ui/ActionForm";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, DefinitionList, PageHeader } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Countdown } from "@/components/ui/Countdown";
import { Field, Input, Select } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { embedded, one, rows } from "@/lib/db";
import { formatRupiah } from "@/lib/money";
import { getSessionProfile } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { formatWib, wibDateInput } from "@/lib/time";
import { cancelPendingEnrollment, reportPayment } from "../../actions";

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
    status: string;
    class: { id: string; name: string } | { id: string; name: string }[] | null;
  } | null;
};
type RefundRow = { id: string; amount: number; cause: string; status: string; bank_reference: string | null; created_at: string };

const BANKS = ["BCA", "Mandiri", "BNI", "BRI", "Other"];
const REFUND_CAUSE: Record<string, string> = {
  business: "The class was closed or changed by us",
  exception: "Agreed with the admin",
  late_no_seat: "Your transfer arrived after the class was full",
};

export default async function StudentInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const session = await getSessionProfile();
  const invoice = one<InvoiceRow>(
    await supabase
      .from("invoices")
      .select("id, kind, hours, rate_per_hour, amount, status, issued_at, payment_due_at, paid_at, cancel_reason, enrollment:enrollments!invoices_enrollment_id_fkey(id, status, class:classes!enrollments_class_id_fkey(id, name))")
      .eq("id", id)
      .maybeSingle(),
  );
  if (!invoice || !session) notFound();

  const enrollment = invoice.enrollment;
  const cls = embedded(enrollment?.class);
  const refunds = enrollment ? rows<RefundRow>(await supabase.from("refunds").select("id, amount, cause, status, bank_reference, created_at").eq("enrollment_id", enrollment.id).order("created_at")) : [];

  const now = new Date().getTime(); // a request-time value on purpose: the page is rendered per request
  const windowOpen = invoice.kind === "initial" ? Boolean(invoice.payment_due_at) && Date.parse(invoice.payment_due_at!) > now : true;
  const expired = invoice.status === "cancelled" && invoice.cancel_reason === "expired";
  const canPay = invoice.status === "unpaid" && windowOpen;
  const showReportForm = canPay || expired;

  return (
    <>
      <PageHeader
        title={`${invoice.kind === "renewal" ? "Renewal" : "First package"} · ${cls?.name}`}
        subtitle={<Link href="/student/invoices" className="underline-offset-2 hover:underline">All invoices</Link>}
        actions={<Badge status={invoice.status} />}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Invoice" />
          <DefinitionList
            items={[
              { label: "Package", value: `${invoice.hours} hours × ${formatRupiah(invoice.rate_per_hour)}` },
              { label: "Amount to pay", value: <span className="text-lg font-bold">{formatRupiah(invoice.amount)}</span> },
              { label: "Issued", value: formatWib(invoice.issued_at) },
              { label: "Paid", value: invoice.paid_at ? formatWib(invoice.paid_at) : "—" },
            ]}
          />
          <p className="border-t border-cloud px-4 py-3 text-xs text-muted">
            No refund if you withdraw from the class. Refunds apply only when the class is closed or changed by us, or for a late transfer
            on a class that was already full.
          </p>
        </Card>

        <Card>
          <CardHeader title="Payment" />
          <div className="space-y-3 p-4 text-sm">
            {invoice.status === "paid" ? (
              <p>
                Paid and confirmed. {cls ? <Link href={`/student/classes/${cls.id}`} className="font-semibold underline-offset-2 hover:underline">Open your class</Link> : null}
              </p>
            ) : null}
            {invoice.status === "awaiting_verification" ? (
              <p>Your transfer has been reported. The admin checks it against the bank statement and confirms it. Your seat stays held meanwhile.</p>
            ) : null}
            {canPay ? (
              <>
                <p>Transfer the amount below, then press &ldquo;I have paid&rdquo; and tell us the details.</p>
                <div className="rounded-card bg-field p-3">
                  <p className="text-xs text-muted">Bank BCA · account 000-000-0000</p>
                  <p className="text-xs text-muted">Star Generation (demo account, payments are simulated)</p>
                  <p className="mt-1 text-lg font-bold">{formatRupiah(invoice.amount)}</p>
                </div>
                {invoice.kind === "initial" && invoice.payment_due_at ? (
                  <p>
                    Your seat is held for you. Pay and report within: <Countdown until={invoice.payment_due_at} />
                  </p>
                ) : null}
              </>
            ) : null}
            {expired ? (
              <div className="rounded-card border border-destructive bg-destructive/5 p-3">
                <p className="font-semibold text-destructive">Invoice expired. Do not transfer.</p>
                <p className="mt-1">
                  The payment window passed and the seat was released. Enroll again if there is a seat. If you already transferred, report it below:
                  when the seat is still free it is honoured at this price, otherwise you are refunded in full.
                </p>
              </div>
            ) : null}
            {invoice.status === "cancelled" && !expired ? <p>This invoice was cancelled{invoice.cancel_reason ? `: ${invoice.cancel_reason}` : ""}.</p> : null}
          </div>

          {showReportForm ? (
            <ActionForm action={reportPayment} className="grid gap-3 border-t border-cloud p-4">
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <p className="text-sm font-semibold">{expired ? "I already transferred" : "I have paid"}</p>
              <Field label="Sender name (account holder)">
                <Input name="senderName" required defaultValue={session.fullName} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Bank">
                  <Select name="bank" defaultValue="BCA">
                    {BANKS.map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Transfer date">
                  <Input name="transferDate" type="date" required defaultValue={wibDateInput(new Date().toISOString())} />
                </Field>
              </div>
              <Field label="Amount transferred (Rp)">
                <Input name="amount" inputMode="numeric" required defaultValue={String(invoice.amount)} />
              </Field>
              <ProofUpload userId={session.userId} invoiceId={invoice.id} />
              <div className="flex flex-wrap items-center gap-2">
                <SubmitButton>{expired ? "Report my transfer" : "I have paid"}</SubmitButton>
              </div>
            </ActionForm>
          ) : null}

          {canPay && invoice.kind === "initial" && enrollment?.status === "pending_payment" ? (
            <div className="border-t border-cloud p-4">
              <ConfirmDialog
                triggerLabel="Cancel enrollment"
                triggerVariant="destructive"
                title="Cancel your enrollment"
                description="Your seat is released and this invoice is cancelled. You can enroll again later if there is a free seat."
                confirmLabel="Cancel enrollment"
                confirmVariant="destructive"
                action={cancelPendingEnrollment}
                values={{ enrollmentId: enrollment.id }}
              />
            </div>
          ) : null}
        </Card>
      </div>

      {refunds.length > 0 ? (
        <section className="mt-5">
          <h2 className="mb-2 text-sm font-semibold">Refunds</h2>
          <Card>
            <ul className="divide-y divide-cloud text-sm">
              {refunds.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span>
                    <span className="font-semibold">{formatRupiah(r.amount)}</span>
                    <span className="text-muted"> — {REFUND_CAUSE[r.cause] ?? r.cause}</span>
                    {r.bank_reference ? <span className="text-muted"> · repaid on {formatWib(r.created_at, { withDate: true })}, ref. {r.bank_reference}</span> : null}
                  </span>
                  <Badge status={r.status} label={r.status === "pending" ? "Being processed" : undefined} />
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}
    </>
  );
}
