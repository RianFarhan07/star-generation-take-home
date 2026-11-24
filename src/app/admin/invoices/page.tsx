import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card, EmptyState, PageHeader } from "@/components/ui/Card";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { embedded, rows } from "@/lib/db";
import { formatRupiah } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { formatWib } from "@/lib/time";

type InvoiceRow = {
  id: string;
  kind: string;
  hours: number;
  rate_per_hour: number;
  amount: number;
  status: string;
  issued_at: string;
  paid_at: string | null;
  payment_due_at: string | null;
  enrollment: {
    student: { full_name: string } | { full_name: string }[] | null;
    class: { name: string } | { name: string }[] | null;
  } | null;
};

const TABS = [
  { status: "awaiting_verification", label: "To verify" },
  { status: "unpaid", label: "Unpaid" },
  { status: "paid", label: "Paid" },
  { status: "cancelled", label: "Cancelled" },
];

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: requested } = await searchParams;
  const status = TABS.some((t) => t.status === requested) ? (requested as string) : "awaiting_verification";
  const supabase = await createClient();
  const { count: toVerify } = await supabase.from("invoices").select("id", { count: "exact", head: true }).eq("status", "awaiting_verification");
  const invoices = rows<InvoiceRow>(
    await supabase
      .from("invoices")
      .select(
        "id, kind, hours, rate_per_hour, amount, status, issued_at, paid_at, payment_due_at, " +
          "enrollment:enrollments!invoices_enrollment_id_fkey(student:profiles!enrollments_student_id_fkey(full_name), class:classes!enrollments_class_id_fkey(name))",
      )
      .eq("status", status)
      .order("issued_at", { ascending: false }),
  );

  return (
    <>
      <PageHeader title="Invoices" subtitle="Students report a bank transfer; you check it against the bank statement and verify it." />
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <Link
            key={tab.status}
            href={`/admin/invoices?status=${tab.status}`}
            className={`rounded-card border px-3 py-1.5 text-sm font-semibold ${
              tab.status === status ? "border-navy bg-navy text-white" : "border-cloud bg-white hover:bg-field"
            }`}
          >
            {tab.label}
            {tab.status === "awaiting_verification" && toVerify ? (
              <span className="ml-2 rounded-full bg-destructive px-1.5 py-0.5 text-[11px] font-bold text-white" aria-label={`${toVerify} waiting`}>
                {toVerify}
              </span>
            ) : null}
          </Link>
        ))}
      </div>
      {invoices.length === 0 ? (
        <Card>
          <EmptyState title="Nothing here" hint="No invoices with this status." />
        </Card>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Student</Th>
              <Th>Class</Th>
              <Th>Invoice</Th>
              <Th>Amount</Th>
              <Th>Status</Th>
              <Th>Date</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <Tr key={i.id}>
                <Td className="font-medium">{embedded(i.enrollment?.student)?.full_name}</Td>
                <Td>{embedded(i.enrollment?.class)?.name}</Td>
                <Td>
                  {i.kind === "renewal" ? "Renewal" : "First"} · {i.hours} h × {formatRupiah(i.rate_per_hour)}
                </Td>
                <Td className="font-medium">{formatRupiah(i.amount)}</Td>
                <Td>
                  <Badge status={i.status} />
                </Td>
                <Td className="text-muted">{formatWib(i.paid_at ?? i.issued_at)}</Td>
                <Td className="text-right">
                  <Link href={`/admin/invoices/${i.id}`} className="font-semibold underline-offset-2 hover:underline">
                    Open
                  </Link>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
