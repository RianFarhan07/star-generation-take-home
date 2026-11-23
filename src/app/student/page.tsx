import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card, EmptyState, PageHeader } from "@/components/ui/Card";
import { embedded, rows } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { formatHours } from "@/lib/time";

type EnrollmentRow = {
  id: string;
  status: string;
  class_id: string;
  class: { name: string } | { name: string }[] | null;
};
type Balance = { remaining_minutes: number; low_hours: boolean; out_of_hours: boolean };

export default async function StudentHome() {
  const supabase = await createClient();
  const enrollments = rows<EnrollmentRow>(
    await supabase
      .from("enrollments")
      .select("id, status, class_id, class:classes!enrollments_class_id_fkey(name)")
      .order("created_at", { ascending: false }),
  );
  const balances = new Map<string, Balance>();
  for (const e of enrollments.filter((x) => x.status === "active")) {
    const { data } = await supabase.rpc("enrollment_balance", { p_enrollment_id: e.id });
    if (data?.[0]) balances.set(e.id, data[0] as Balance);
  }
  const current = enrollments.filter((e) => ["active", "pending_payment", "awaiting_verification"].includes(e.status));
  const past = enrollments.filter((e) => !current.includes(e));

  return (
    <>
      <PageHeader
        title="My classes"
        subtitle="Classes you have paid for show their schedule, hours and logbooks."
        actions={<LinkButton href="/student/classes" variant="primary">Browse classes</LinkButton>}
      />

      {current.length === 0 ? (
        <Card>
          <EmptyState title="You are not enrolled in a class yet" hint="Browse the classes, enroll and pay the invoice to get access." />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {current.map((e) => {
            const balance = balances.get(e.id);
            const name = embedded(e.class)?.name;
            return (
              <Card key={e.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold">{name}</h2>
                  <Badge status={e.status} />
                </div>
                {e.status === "active" ? (
                  <>
                    <p className="mt-3 text-sm text-muted">Hours left</p>
                    <p className="flex flex-wrap items-center gap-2 text-2xl font-bold">
                      {balance ? formatHours(balance.remaining_minutes) : "—"}
                      {balance?.out_of_hours ? <Badge status="out_of_hours" /> : balance?.low_hours ? <Badge status="low_hours" /> : null}
                    </p>
                    <Link href={`/student/classes/${e.class_id}`} className="mt-3 inline-block text-sm font-semibold underline-offset-2 hover:underline">
                      Open class
                    </Link>
                  </>
                ) : (
                  <p className="mt-3 text-sm text-muted">
                    {e.status === "pending_payment"
                      ? "Your seat is held while you pay the invoice."
                      : "Your transfer is waiting for the admin to verify it."}{" "}
                    <Link href="/student/invoices" className="font-semibold text-navy underline-offset-2 hover:underline">
                      See invoice
                    </Link>
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {past.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold">Earlier enrollments</h2>
          <Card>
            <ul className="divide-y divide-cloud text-sm">
              {past.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span>{embedded(e.class)?.name}</span>
                  <Badge status={e.status} />
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}
    </>
  );
}
