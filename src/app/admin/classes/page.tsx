import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { embedded, LIVE_STATUSES, rows } from "@/lib/db";
import { formatRupiah } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

type ClassRow = { id: string; name: string; capacity: number; package_hours: number; tutor: { full_name: string } | { full_name: string }[] | null };
type RateRow = { class_id: string; student_rate_per_hour: number; tutor_rate_per_hour: number };

export default async function ClassesPage() {
  const supabase = await createClient();
  const [classes, rates, held] = await Promise.all([
    supabase.from("classes").select("id, name, capacity, package_hours, tutor:profiles!classes_tutor_id_fkey(full_name)").order("name"),
    supabase
      .from("class_rates")
      .select("class_id, student_rate_per_hour, tutor_rate_per_hour")
      .lte("effective_from", new Date().toISOString())
      .order("effective_from", { ascending: false }),
    supabase.from("enrollments").select("class_id").in("status", LIVE_STATUSES),
  ]);

  const currentRate = new Map<string, RateRow>();
  for (const rate of rows<RateRow>(rates)) if (!currentRate.has(rate.class_id)) currentRate.set(rate.class_id, rate);
  const seats = new Map<string, number>();
  for (const row of rows<{ class_id: string }>(held)) seats.set(row.class_id, (seats.get(row.class_id) ?? 0) + 1);
  const list = rows<ClassRow>(classes);

  return (
    <>
      <PageHeader
        title="Classes"
        subtitle="Create classes, set rates and capacity, assign tutors."
        actions={<LinkButton href="/admin/classes/new" variant="primary">New class</LinkButton>}
      />
      {list.length === 0 ? (
        <EmptyState title="No classes yet" hint="Create the first class to get started." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Class</Th>
              <Th>Tutor</Th>
              <Th>Seats</Th>
              <Th>Package</Th>
              <Th>Student rate</Th>
              <Th>Tutor rate</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const rate = currentRate.get(c.id);
              return (
                <Tr key={c.id}>
                  <Td className="font-medium">{c.name}</Td>
                  <Td>{embedded(c.tutor)?.full_name}</Td>
                  <Td>
                    {seats.get(c.id) ?? 0} / {c.capacity}
                  </Td>
                  <Td>{c.package_hours} h</Td>
                  <Td>{rate ? `${formatRupiah(rate.student_rate_per_hour)} /h` : "—"}</Td>
                  <Td>{rate ? `${formatRupiah(rate.tutor_rate_per_hour)} /h` : "—"}</Td>
                  <Td className="text-right">
                    <Link href={`/admin/classes/${c.id}`} className="font-semibold underline-offset-2 hover:underline">
                      Open
                    </Link>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
