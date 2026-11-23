import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card, EmptyState, PageHeader } from "@/components/ui/Card";
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
  payment_due_at: string | null;
  enrollment: { class: { name: string } | { name: string }[] | null } | null;
};

export default async function StudentInvoicesPage() {
  const supabase = await createClient();
  const invoices = rows<InvoiceRow>(
    await supabase
      .from("invoices")
      .select("id, kind, hours, rate_per_hour, amount, status, issued_at, payment_due_at, enrollment:enrollments!invoices_enrollment_id_fkey(class:classes!enrollments_class_id_fkey(name))")
      .order("issued_at", { ascending: false }),
  );

  return (
    <>
      <PageHeader title="Invoices" subtitle="Your invoices and payments. A package invoice is for a block of lesson hours." />
      {invoices.length === 0 ? (
        <Card>
          <EmptyState title="No invoices yet" hint="An invoice is created when you enroll in a class." />
        </Card>
      ) : (
        <div className="space-y-3">
          {invoices.map((i) => (
            <Card key={i.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{embedded(i.enrollment?.class)?.name}</p>
                  <p className="text-sm text-muted">
                    {i.kind === "renewal" ? "Renewal" : "First package"} · {i.hours} h × {formatRupiah(i.rate_per_hour)} · issued {formatWib(i.issued_at)}
                  </p>
                </div>
                <Badge status={i.status} />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-lg font-bold">{formatRupiah(i.amount)}</span>
                <Link href={`/student/invoices/${i.id}`} className="text-sm font-semibold underline-offset-2 hover:underline">
                  {i.status === "unpaid" ? "Pay now" : "View"}
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
