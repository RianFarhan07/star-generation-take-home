import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card, EmptyState, PageHeader } from "@/components/ui/Card";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { embedded, rows } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { formatMonth, formatWib } from "@/lib/time";

type LogbookRow = {
  id: string;
  month: string;
  status: string;
  submitted_at: string | null;
  approved_at: string | null;
  class: { name: string } | { name: string }[] | null;
  entries: { count: number }[];
};

const ORDER = ["submitted", "changes_requested", "draft", "approved"];

export default async function LogbooksPage() {
  const supabase = await createClient();
  const list = rows<LogbookRow>(
    await supabase
      .from("logbooks")
      .select("id, month, status, submitted_at, approved_at, class:classes!logbooks_class_id_fkey(name), entries:logbook_entries(count)")
      .order("month", { ascending: false }),
  ).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));

  return (
    <>
      <PageHeader title="Logbooks" subtitle="Tutors write one entry per lesson and submit a month at a time. Review it, preview what the tutor earns, then approve." />
      {list.length === 0 ? (
        <Card>
          <EmptyState title="No logbooks yet" hint="A logbook appears when a tutor writes the first entry of a month." />
        </Card>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Class</Th>
              <Th>Month</Th>
              <Th>Entries</Th>
              <Th>Status</Th>
              <Th>Date</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {list.map((l) => (
              <Tr key={l.id}>
                <Td className="font-medium">{embedded(l.class)?.name}</Td>
                <Td>{formatMonth(l.month)}</Td>
                <Td>{l.entries[0]?.count ?? 0}</Td>
                <Td>
                  <Badge status={l.status} />
                </Td>
                <Td className="text-muted">{l.approved_at ? formatWib(l.approved_at) : l.submitted_at ? formatWib(l.submitted_at) : "—"}</Td>
                <Td className="text-right">
                  <Link href={`/admin/logbooks/${l.id}`} className="font-semibold underline-offset-2 hover:underline">
                    {l.status === "submitted" ? "Review" : "Open"}
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
