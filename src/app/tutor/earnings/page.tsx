import { Card, EmptyState, PageHeader, StatGrid, StatTile } from "@/components/ui/Card";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { embedded, rows } from "@/lib/db";
import { formatRupiah } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { formatHours, formatWib } from "@/lib/time";

type EarningRow = {
  id: string;
  minutes: number;
  rate_per_hour: number;
  amount: number;
  lesson: { starts_at: string } | { starts_at: string }[] | null;
  class: { name: string } | { name: string }[] | null;
};

export default async function EarningsPage() {
  const supabase = await createClient();
  const earnings = rows<EarningRow>(
    await supabase
      .from("tutor_earnings")
      .select("id, minutes, rate_per_hour, amount, lesson:lessons!tutor_earnings_lesson_id_fkey(starts_at), class:classes!tutor_earnings_class_id_fkey(name)"),
  ).sort((a, b) => (embedded(b.lesson)?.starts_at ?? "").localeCompare(embedded(a.lesson)?.starts_at ?? ""));
  const total = earnings.reduce((sum, e) => sum + e.amount, 0);

  return (
    <>
      <PageHeader title="Earnings" subtitle="What you earn for lessons in logbooks the admin has approved: your rate times the lesson hours." />
      <div className="mb-5 max-w-xs">
        <StatGrid>
          <StatTile label="Approved total" value={formatRupiah(total)} hint={`${earnings.length} lesson(s)`} />
        </StatGrid>
      </div>
      {earnings.length === 0 ? (
        <Card>
          <EmptyState title="No approved earnings yet" hint="Earnings appear here once the admin approves a logbook you submitted." />
        </Card>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Lesson</Th>
              <Th>Class</Th>
              <Th>Hours</Th>
              <Th>Your rate</Th>
              <Th className="text-right">Earned</Th>
            </tr>
          </thead>
          <tbody>
            {earnings.map((e) => (
              <Tr key={e.id}>
                <Td>{embedded(e.lesson) ? formatWib(embedded(e.lesson)!.starts_at) : ""}</Td>
                <Td>{embedded(e.class)?.name}</Td>
                <Td>{formatHours(e.minutes)}</Td>
                <Td>{formatRupiah(e.rate_per_hour)} /h</Td>
                <Td className="text-right font-medium">{formatRupiah(e.amount)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
