import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card, EmptyState, PageHeader, StatGrid, StatTile } from "@/components/ui/Card";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { formatRupiah } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { formatHours, formatMonth, formatWib, wibMonthStart } from "@/lib/time";

type StatementRow = {
  lesson_id: string;
  class_id: string;
  class_name: string;
  starts_at: string;
  minutes: number;
  rate_per_hour: number;
  amount: number;
  status: "scheduled" | "taught" | "submitted" | "approved";
  has_entry: boolean;
};

const STATUS_LABEL: Record<StatementRow["status"], string> = {
  scheduled: "Scheduled",
  taught: "Taught",
  submitted: "Submitted",
  approved: "Approved",
};

/**
 * The tutor's earnings statement: every lesson with what it earns and where it stands, so the question
 * "what will I be paid?" is answered here instead of by asking the admin. Approved amounts are final;
 * the others are estimates computed by the same function the admin's preview and the approval use.
 */
export default async function EarningsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: requested } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("tutor_earnings_statement");
  if (error) throw new Error(error.message);
  const all = ((data ?? []) as StatementRow[]).sort((a, b) => b.starts_at.localeCompare(a.starts_at));

  const months = [...new Set(all.map((r) => wibMonthStart(r.starts_at)))].sort().reverse();
  const month = months.find((m) => m.slice(0, 7) === requested) ?? null;
  const shown = month ? all.filter((r) => wibMonthStart(r.starts_at) === month) : all;

  const sum = (status: StatementRow["status"][]) => shown.filter((r) => status.includes(r.status)).reduce((total, r) => total + r.amount, 0);
  const approved = sum(["approved"]);
  const awaiting = sum(["taught", "submitted"]);
  const upcoming = sum(["scheduled"]);
  const needEntry = shown.filter((r) => r.status === "taught" && !r.has_entry);

  return (
    <>
      <PageHeader title="Earnings" subtitle="Your rate times the lesson hours. You are paid once the admin has approved the month's logbook." />

      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/tutor/earnings" className={`rounded-card border px-3 py-1.5 text-sm font-semibold ${!month ? "border-navy bg-navy text-white" : "border-cloud bg-white hover:bg-field"}`}>
          All months
        </Link>
        {months.map((m) => (
          <Link
            key={m}
            href={`/tutor/earnings?month=${m.slice(0, 7)}`}
            className={`rounded-card border px-3 py-1.5 text-sm font-semibold ${m === month ? "border-navy bg-navy text-white" : "border-cloud bg-white hover:bg-field"}`}
          >
            {formatMonth(m)}
          </Link>
        ))}
      </div>

      <StatGrid>
        <StatTile label="Approved (final)" value={formatRupiah(approved)} hint="Recorded when the admin approved the logbook" />
        <StatTile label="Awaiting approval (estimate)" value={formatRupiah(awaiting)} hint="Lessons taught, logbook not approved yet" />
        <StatTile label="Upcoming (estimate)" value={formatRupiah(upcoming)} hint="Lessons still to teach" />
      </StatGrid>

      {needEntry.length > 0 ? (
        <div className="mt-4 rounded-card border border-gold bg-gold/15 p-4 text-sm">
          <p className="font-semibold">{needEntry.length} lesson(s) still need a logbook entry</p>
          <p className="mt-1 text-muted">Your logbook can only be submitted, and you only get paid for it, once every lesson of the month has an entry.</p>
          <ul className="mt-2 space-y-1">
            {needEntry.map((r) => (
              <li key={r.lesson_id}>
                <Link href={`/tutor/logbooks/${r.class_id}/${wibMonthStart(r.starts_at).slice(0, 7)}`} className="font-semibold underline-offset-2 hover:underline">
                  {formatWib(r.starts_at)} · {r.class_name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="mt-5">
        {shown.length === 0 ? (
          <Card>
            <EmptyState title="No lessons yet" hint="Lessons you teach appear here with what they earn." />
          </Card>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Lesson</Th>
                <Th>Class</Th>
                <Th>Hours</Th>
                <Th>Your rate</Th>
                <Th>Status</Th>
                <Th className="text-right">Earned</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <Tr key={r.lesson_id}>
                  <Td>{formatWib(r.starts_at)}</Td>
                  <Td>{r.class_name}</Td>
                  <Td>{formatHours(r.minutes)}</Td>
                  <Td>{formatRupiah(r.rate_per_hour)} /h</Td>
                  <Td>
                    <Badge status={r.status} label={STATUS_LABEL[r.status]} />
                  </Td>
                  <Td className="text-right font-medium">
                    {formatRupiah(r.amount)}
                    {r.status !== "approved" ? <span className="ml-1 text-xs font-normal text-muted">estimate</span> : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </>
  );
}
