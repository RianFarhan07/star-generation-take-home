import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, EmptyState, PageHeader, StatGrid, StatTile } from "@/components/ui/Card";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { formatRupiah } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { formatHours, formatWib } from "@/lib/time";

type Attention = { kind: string; id: string; who: string; detail: string; status: string; since: string; overdue: boolean; link_id: string };
type Balance = {
  enrollment_id: string;
  student_name: string;
  class_name: string;
  purchased_minutes: number;
  used_minutes: number;
  remaining_minutes: number;
  low_hours: boolean;
  out_of_hours: boolean;
};
type Overview = {
  stats: {
    outstanding: number;
    to_verify: number;
    to_verify_overdue: number;
    low_hours: number;
    out_of_hours: number;
    pending_refunds: number;
    pending_refunds_total: number;
  };
  attention: Attention[];
  balances: Balance[];
  classes: { class_id: string; name: string; seats_taken: number; capacity: number }[];
};

const KIND: Record<string, { label: string; href: (a: Attention) => string; action: string }> = {
  verify_payment: { label: "Payment to verify", href: (a) => `/admin/invoices/${a.link_id}`, action: "Verify" },
  review_logbook: { label: "Logbook to review", href: (a) => `/admin/logbooks/${a.id}`, action: "Review" },
  renewal_unpaid: { label: "Renewal unpaid", href: (a) => `/admin/invoices/${a.link_id}`, action: "View" },
  refund_pending: { label: "Refund to repay", href: () => "/admin/refunds", action: "Open" },
};

export default async function AdminOverviewPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_overview");
  if (error) throw new Error(error.message);
  const overview = data as Overview;
  const { stats } = overview;

  return (
    <>
      <PageHeader title="Overview" subtitle="What needs your attention today: payments to check, logbooks to review, hours running out and money still to collect or repay." />

      <StatGrid>
        <StatTile label="Outstanding (not yet paid)" value={formatRupiah(stats.outstanding)} hint="Invoices waiting for a payment or its verification" />
        <StatTile
          label="Payments to verify"
          value={
            <span className="flex items-center gap-2">
              {stats.to_verify}
              {stats.to_verify_overdue > 0 ? <Badge status="overdue" label={`${stats.to_verify_overdue} overdue`} /> : null}
            </span>
          }
          hint="Overdue = reported more than 24 hours ago"
        />
        <StatTile
          label="Students low on hours"
          value={
            <span className="flex items-center gap-2">
              {stats.low_hours}
              {stats.out_of_hours > 0 ? <Badge status="out_of_hours" label={`${stats.out_of_hours} out`} /> : null}
            </span>
          }
          hint="3 hours or less left"
        />
        <StatTile label="Refunds to repay" value={stats.pending_refunds} hint={stats.pending_refunds > 0 ? formatRupiah(stats.pending_refunds_total) : "Nothing pending"} />
      </StatGrid>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">Needs attention</h2>
        {overview.attention.length === 0 ? (
          <Card>
            <EmptyState title="All clear" hint="No payments, logbooks or refunds are waiting for you." />
          </Card>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th>Who</Th>
                <Th>Detail</Th>
                <Th>Status</Th>
                <Th>Since</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {overview.attention.map((a) => {
                const kind = KIND[a.kind];
                return (
                  <Tr key={`${a.kind}-${a.id}`}>
                    <Td className="font-medium">{kind?.label ?? a.kind}</Td>
                    <Td>{a.who}</Td>
                    <Td className="text-muted">{a.detail}</Td>
                    <Td>
                      <Badge status={a.overdue ? "overdue" : a.status} />
                    </Td>
                    <Td className="text-muted">{formatWib(a.since)}</Td>
                    <Td className="text-right">
                      <Link href={kind?.href(a) ?? "/admin"} className="font-semibold underline-offset-2 hover:underline">
                        {kind?.action ?? "Open"}
                      </Link>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </section>

      <div className="mt-6 grid gap-5 xl:grid-cols-3">
        <section className="xl:col-span-2">
          <h2 className="mb-2 text-sm font-semibold">Hours by student</h2>
          {overview.balances.length === 0 ? (
            <Card>
              <EmptyState title="No active students yet" />
            </Card>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Student</Th>
                  <Th>Class</Th>
                  <Th>Bought</Th>
                  <Th>Used</Th>
                  <Th>Left</Th>
                </tr>
              </thead>
              <tbody>
                {overview.balances.map((b) => (
                  <Tr key={b.enrollment_id}>
                    <Td className="font-medium">{b.student_name}</Td>
                    <Td>{b.class_name}</Td>
                    <Td>{formatHours(b.purchased_minutes)}</Td>
                    <Td>{formatHours(b.used_minutes)}</Td>
                    <Td>
                      <span className="inline-flex items-center gap-2">
                        {formatHours(b.remaining_minutes)}
                        {b.out_of_hours ? <Badge status="out_of_hours" /> : b.low_hours ? <Badge status="low_hours" /> : null}
                      </span>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">Seats per class</h2>
          <Card>
            <CardHeader title="Seats held / capacity" />
            {overview.classes.length === 0 ? (
              <EmptyState title="No classes yet" />
            ) : (
              <ul className="divide-y divide-cloud text-sm">
                {overview.classes.map((c) => (
                  <li key={c.class_id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <Link href={`/admin/classes/${c.class_id}`} className="font-medium underline-offset-2 hover:underline">
                      {c.name}
                    </Link>
                    <span className="text-muted">
                      {c.seats_taken} / {c.capacity}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </>
  );
}
