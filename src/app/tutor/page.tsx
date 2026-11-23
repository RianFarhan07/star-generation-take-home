import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/Card";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { rows } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";

type ClassRow = { id: string; name: string; capacity: number; package_hours: number };
type RosterRow = { student_id: string; full_name: string; enrollment_status: string; next_lesson_covered: boolean | null; low_hours: boolean };

export default async function TutorHome() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const classes = rows<ClassRow>(
    await supabase.from("classes").select("id, name, capacity, package_hours").eq("tutor_id", auth.user!.id).order("name"),
  );
  const rosters = await Promise.all(
    classes.map(async (c) => {
      const { data, error } = await supabase.rpc("class_roster", { p_class_id: c.id });
      if (error) throw new Error(error.message);
      return [c.id, (data ?? []) as RosterRow[]] as const;
    }),
  );
  const rosterOf = new Map(rosters);

  return (
    <>
      <PageHeader title="My classes" subtitle="The classes you teach and the students in them." />
      {classes.length === 0 ? (
        <Card>
          <EmptyState title="No classes assigned to you yet" hint="When an admin assigns you a class it appears here." />
        </Card>
      ) : (
        <div className="space-y-5">
          {classes.map((c) => {
            const roster = rosterOf.get(c.id) ?? [];
            return (
              <Card key={c.id}>
                <CardHeader
                  title={c.name}
                  actions={
                    <span className="flex items-center gap-3 text-xs text-muted">
                      {roster.length} of {c.capacity} seats
                      <Link href="/tutor/schedule" className="font-semibold text-navy underline-offset-2 hover:underline">
                        Schedule
                      </Link>
                      <Link href="/tutor/logbooks" className="font-semibold text-navy underline-offset-2 hover:underline">
                        Logbooks
                      </Link>
                    </span>
                  }
                />
                {roster.length === 0 ? (
                  <EmptyState title="No students yet" hint="Students appear once they enroll." />
                ) : (
                  <Table>
                    <thead>
                      <tr>
                        <Th>Student</Th>
                        <Th>Status</Th>
                        <Th>Hours</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {roster.map((s) => (
                        <Tr key={s.student_id}>
                          <Td className="font-medium">{s.full_name}</Td>
                          <Td>
                            <Badge status={s.enrollment_status} />
                          </Td>
                          <Td>
                            {s.enrollment_status !== "active" ? (
                              <span className="text-muted">Not paid yet</span>
                            ) : s.next_lesson_covered === false ? (
                              <Badge status="out_of_hours" />
                            ) : s.low_hours ? (
                              <Badge status="low_hours" />
                            ) : (
                              <span className="text-muted">OK</span>
                            )}
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
