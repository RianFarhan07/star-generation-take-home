import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { embedded, one, rows } from "@/lib/db";
import { formatRupiah } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { summarizeProgress } from "@/lib/progress";
import { formatHours, formatMonth, formatWib } from "@/lib/time";
import { issueRenewal, withdraw } from "../../actions";

type LessonRow = { id: string; starts_at: string; ends_at: string; duration_minutes: number; status: string; cancel_reason: string | null };
type LogbookRow = {
  id: string;
  month: string;
  entries: {
    id: string;
    topic: string;
    activities: string;
    observation: string;
    recommendation: string;
    lesson: { starts_at: string } | { starts_at: string }[] | null;
  }[];
};
type Balance = {
  purchased_minutes: number;
  used_minutes: number;
  remaining_minutes: number;
  remaining_value: number;
  low_hours: boolean;
  out_of_hours: boolean;
};

export default async function StudentClassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const enrollment = one<{ id: string; status: string }>(
    await supabase
      .from("enrollments")
      .select("id, status")
      .eq("class_id", id)
      .in("status", ["pending_payment", "awaiting_verification", "active"])
      .maybeSingle(),
  );
  if (!enrollment) redirect("/student/classes");
  if (enrollment.status !== "active") redirect("/student/invoices");

  const cls = one<{ id: string; name: string; description: string }>(await supabase.from("classes").select("id, name, description").eq("id", id).maybeSingle());
  if (!cls) notFound();

  const [lessonsResult, logbooksResult, balanceResult, openInvoices] = await Promise.all([
    supabase.from("lessons").select("id, starts_at, ends_at, duration_minutes, status, cancel_reason").eq("class_id", id).order("starts_at"),
    supabase
      .from("logbooks")
      .select("id, month, entries:logbook_entries(id, topic, activities, observation, recommendation, lesson:lessons!logbook_entries_lesson_id_fkey(starts_at))")
      .eq("class_id", id)
      .order("month", { ascending: false }),
    supabase.rpc("enrollment_balance", { p_enrollment_id: enrollment.id }),
    supabase.from("invoices").select("id").eq("enrollment_id", enrollment.id).in("status", ["unpaid", "awaiting_verification"]),
  ]);
  if (balanceResult.error) throw new Error(balanceResult.error.message);
  const balance = (balanceResult.data as Balance[])[0];
  const lessons = rows<LessonRow>(lessonsResult);
  const logbooks = rows<LogbookRow>(logbooksResult);
  const openInvoice = rows<{ id: string }>(openInvoices)[0];
  const now = new Date().toISOString();
  const upcoming = lessons.filter((l) => l.ends_at > now);
  const past = lessons.filter((l) => l.ends_at <= now).reverse();
  const progress = summarizeProgress(
    logbooks.flatMap((book) =>
      book.entries.map((e) => ({ starts_at: embedded(e.lesson)?.starts_at ?? "", topic: e.topic, recommendation: e.recommendation })),
    ),
  );
  const usedPercent = balance.purchased_minutes > 0 ? Math.min(100, Math.round((balance.used_minutes / balance.purchased_minutes) * 100)) : 0;

  return (
    <>
      <PageHeader
        title={cls.name}
        subtitle={<Link href="/student" className="underline-offset-2 hover:underline">My classes</Link>}
        actions={
          <>
            {openInvoice ? (
              <Link href={`/student/invoices/${openInvoice.id}`} className="rounded-card bg-navy px-3.5 py-2 text-sm font-semibold text-white">
                Pay open invoice
              </Link>
            ) : (
              <ConfirmDialog
                triggerLabel="Renew package"
                triggerVariant="primary"
                title="Renew your package"
                description="You get a new invoice for another package at the current rate. The new hours are added after you pay."
                confirmLabel="Get renewal invoice"
                action={issueRenewal}
                values={{ enrollmentId: enrollment.id, classId: id }}
              />
            )}
            <ConfirmDialog
              triggerLabel="Withdraw"
              triggerVariant="destructive"
              title="Withdraw from this class"
              description={`You will give up ${formatHours(balance.remaining_minutes)} that are still left (worth ${formatRupiah(balance.remaining_value)}). There is no refund if you withdraw yourself. Your seat is released.`}
              confirmLabel="Withdraw"
              confirmVariant="destructive"
              reasonLabel="Why are you leaving? (optional note)"
              action={withdraw}
              values={{ enrollmentId: enrollment.id }}
            />
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-1">
          <p className="text-xs text-muted">Hours left</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-3xl font-bold">
            {formatHours(balance.remaining_minutes)}
            {balance.out_of_hours ? <Badge status="out_of_hours" /> : balance.low_hours ? <Badge status="low_hours" /> : null}
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-cloud" aria-hidden>
            <div className="h-full bg-gold" style={{ width: `${usedPercent}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted">
            {formatHours(balance.used_minutes)} used of {formatHours(balance.purchased_minutes)} bought. Every lesson that takes place uses its hours, whether or not you attend.
          </p>
          {balance.out_of_hours ? (
            <p className="mt-2 text-xs font-semibold text-destructive">Your hours do not cover the next lesson. Renew to keep your seat.</p>
          ) : null}
        </Card>

        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Upcoming lessons (WIB)" />
            {upcoming.length === 0 ? (
              <EmptyState title="No upcoming lessons" />
            ) : (
              <ul className="divide-y divide-cloud text-sm">
                {upcoming.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <span className={l.status === "cancelled" ? "text-muted line-through" : ""}>
                      {formatWib(l.starts_at)} – {formatWib(l.ends_at, { withDate: false })}
                    </span>
                    {l.status === "cancelled" ? (
                      <span className="flex items-center gap-2">
                        <Badge status="cancelled" />
                        <span className="text-xs text-muted">{l.cancel_reason}</span>
                      </span>
                    ) : (
                      <span className="text-muted">{formatHours(l.duration_minutes)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Past lessons" />
            {past.length === 0 ? (
              <EmptyState title="No lessons yet" />
            ) : (
              <ul className="divide-y divide-cloud text-sm">
                {past.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <span className={l.status === "cancelled" ? "text-muted line-through" : ""}>{formatWib(l.starts_at)}</span>
                    {l.status === "cancelled" ? (
                      <span className="flex items-center gap-2">
                        <Badge status="cancelled" />
                        <span className="text-xs text-muted">{l.cancel_reason}</span>
                      </span>
                    ) : (
                      <span className="text-muted">{formatHours(l.duration_minutes)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {progress.next ? (
        <section className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="rounded-card border border-gold bg-gold/15 p-4 lg:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">What&apos;s next</p>
            <p className="mt-1 text-base font-semibold">{progress.next.recommendation}</p>
            <p className="mt-1 text-xs text-muted">
              From the lesson on {formatWib(progress.next.starts_at)} · {progress.next.topic}
            </p>
          </div>
          <Card className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Topics covered ({progress.topics.length})</p>
            <ul className="mt-2 space-y-1 text-sm">
              {progress.topics.slice(0, 6).map((t) => (
                <li key={t.starts_at} className="flex justify-between gap-3">
                  <span>{t.topic}</span>
                  <span className="text-xs text-muted">{formatWib(t.starts_at, { withDate: true }).split(" · ")[0]}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}

      <section className="mt-6">
        <h2 className="mb-1 text-sm font-semibold">Logbooks</h2>
        <p className="mb-3 text-xs text-muted">What was covered and what comes next, once the admin has approved the month.</p>
        {logbooks.length === 0 ? (
          <Card>
            <EmptyState title="No approved logbook yet" hint="A month appears here after the tutor has submitted it and the admin has approved it." />
          </Card>
        ) : (
          <div className="space-y-4">
            {logbooks.map((book) => (
              <Card key={book.id}>
                <CardHeader title={formatMonth(book.month)} />
                <div className="divide-y divide-cloud">
                  {[...book.entries]
                    .sort((a, b) => (embedded(a.lesson)?.starts_at ?? "").localeCompare(embedded(b.lesson)?.starts_at ?? ""))
                    .map((entry) => (
                      <div key={entry.id} className="space-y-2 p-4 text-sm">
                        <p className="font-semibold">
                          {embedded(entry.lesson) ? formatWib(embedded(entry.lesson)!.starts_at) : ""} · {entry.topic}
                        </p>
                        <p className="whitespace-pre-wrap">{entry.activities}</p>
                        <p>
                          <span className="text-xs text-muted">Tutor observation: </span>
                          {entry.observation}
                        </p>
                        <p className="rounded-card bg-gold/15 p-2">
                          <span className="text-xs font-semibold">Next: </span>
                          {entry.recommendation}
                        </p>
                      </div>
                    ))}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
