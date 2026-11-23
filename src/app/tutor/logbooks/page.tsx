import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card, EmptyState, PageHeader } from "@/components/ui/Card";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { rows } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { formatMonth, wibMonthStart } from "@/lib/time";

type LessonRow = { id: string; class_id: string; starts_at: string; ends_at: string };
type LogbookRow = { class_id: string; month: string; status: string };

export default async function TutorLogbooksPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const [classesResult, lessonsResult, logbooksResult, entriesResult] = await Promise.all([
    supabase.from("classes").select("id, name").eq("tutor_id", auth.user!.id).order("name"),
    supabase.from("lessons").select("id, class_id, starts_at, ends_at").eq("status", "scheduled"),
    supabase.from("logbooks").select("class_id, month, status"),
    supabase.from("logbook_entries").select("lesson_id"),
  ]);
  const classes = rows<{ id: string; name: string }>(classesResult);
  const lessons = rows<LessonRow>(lessonsResult);
  const logbooks = rows<LogbookRow>(logbooksResult);
  const written = new Set(rows<{ lesson_id: string }>(entriesResult).map((e) => e.lesson_id));
  const now = new Date().toISOString();

  // One row per class and WIB month that has a lesson which has ended, or a logbook already.
  type Month = { classId: string; className: string; month: string; ended: number; entries: number; status: string | null };
  const months = new Map<string, Month>();
  for (const c of classes) {
    for (const l of lessons.filter((x) => x.class_id === c.id && x.ends_at <= now)) {
      const month = wibMonthStart(l.starts_at);
      const key = `${c.id}|${month}`;
      const row = months.get(key) ?? { classId: c.id, className: c.name, month, ended: 0, entries: 0, status: null };
      row.ended += 1;
      if (written.has(l.id)) row.entries += 1;
      months.set(key, row);
    }
    for (const b of logbooks.filter((x) => x.class_id === c.id)) {
      const key = `${c.id}|${b.month}`;
      const row = months.get(key) ?? { classId: c.id, className: c.name, month: b.month, ended: 0, entries: 0, status: null };
      row.status = b.status;
      months.set(key, row);
    }
  }
  const list = [...months.values()].sort((a, b) => b.month.localeCompare(a.month) || a.className.localeCompare(b.className));

  return (
    <>
      <PageHeader
        title="Logbooks"
        subtitle="One logbook per class per month: write an entry for each lesson that has ended, then submit the month for approval."
      />
      {list.length === 0 ? (
        <Card>
          <EmptyState title="Nothing to write up yet" hint="Months appear here once a lesson has ended." />
        </Card>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Class</Th>
              <Th>Month</Th>
              <Th>Entries</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {list.map((m) => (
              <Tr key={`${m.classId}|${m.month}`}>
                <Td className="font-medium">{m.className}</Td>
                <Td>{formatMonth(m.month)}</Td>
                <Td>
                  {m.entries} of {m.ended} lessons
                  {m.entries < m.ended ? <span className="ml-2 text-xs font-semibold text-destructive">{m.ended - m.entries} missing</span> : null}
                </Td>
                <Td>{m.status ? <Badge status={m.status} /> : <Badge status="draft" label="Not started" />}</Td>
                <Td className="text-right">
                  <Link href={`/tutor/logbooks/${m.classId}/${m.month.slice(0, 7)}`} className="font-semibold underline-offset-2 hover:underline">
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
