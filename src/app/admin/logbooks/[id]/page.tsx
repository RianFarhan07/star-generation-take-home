import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/ActionForm";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { Td, Th, Tr } from "@/components/ui/Table";
import { embedded, one, rows } from "@/lib/db";
import { formatRupiah } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { formatHours, formatMonth, formatWib } from "@/lib/time";
import { approveLogbook, editLogbookEntry, requestLogbookChanges } from "../../actions";

type Named = { full_name: string } | { full_name: string }[] | null;
type LogbookRow = {
  id: string;
  month: string;
  status: string;
  submitted_at: string | null;
  approved_at: string | null;
  class: { id: string; name: string } | { id: string; name: string }[] | null;
};
type EntryRow = {
  id: string;
  topic: string;
  activities: string;
  observation: string;
  recommendation: string;
  edited_by_admin: boolean;
  lesson: { starts_at: string; ends_at: string; tutor: Named } | { starts_at: string; ends_at: string; tutor: Named }[] | null;
};
type RevisionRow = { entry_id: string; topic: string; activities: string; observation: string; recommendation: string; edited_at: string };
type ReviewRow = { id: string; action: string; comment: string | null; entry_id: string | null; created_at: string };
type PreviewRow = { lesson_id: string; starts_at: string; tutor_name: string; minutes: number; rate_per_hour: number; amount: number };

export default async function LogbookReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const logbook = one<LogbookRow>(
    await supabase
      .from("logbooks")
      .select("id, month, status, submitted_at, approved_at, class:classes!logbooks_class_id_fkey(id, name)")
      .eq("id", id)
      .maybeSingle(),
  );
  if (!logbook) notFound();

  const [entriesResult, reviewsResult, previewResult] = await Promise.all([
    supabase
      .from("logbook_entries")
      .select("id, topic, activities, observation, recommendation, edited_by_admin, lesson:lessons!logbook_entries_lesson_id_fkey(starts_at, ends_at, tutor:profiles!lessons_tutor_id_fkey(full_name))")
      .eq("logbook_id", id),
    supabase.from("logbook_reviews").select("id, action, comment, entry_id, created_at").eq("logbook_id", id).order("created_at"),
    supabase.rpc("preview_logbook_earnings", { p_logbook_id: id }),
  ]);
  const entries = rows<EntryRow>(entriesResult).sort(
    (a, b) => (embedded(a.lesson)?.starts_at ?? "").localeCompare(embedded(b.lesson)?.starts_at ?? ""),
  );
  const reviews = rows<ReviewRow>(reviewsResult).filter((r) => r.entry_id === null);
  if (previewResult.error) throw new Error(previewResult.error.message);
  const preview = (previewResult.data ?? []) as PreviewRow[];
  const total = preview.reduce((sum, row) => sum + row.amount, 0);

  const revisionsResult = entries.length
    ? await supabase
        .from("logbook_entry_revisions")
        .select("entry_id, topic, activities, observation, recommendation, edited_at")
        .in("entry_id", entries.map((e) => e.id))
        .order("edited_at")
    : { data: [], error: null };
  const revisions = rows<RevisionRow>(revisionsResult);

  const cls = embedded(logbook.class);
  const submitted = logbook.status === "submitted";
  const tutorNames = [...new Set(preview.map((p) => p.tutor_name))].join(", ");

  return (
    <>
      <PageHeader
        title={`${cls?.name} — ${formatMonth(logbook.month)}`}
        subtitle={
          <>
            <Link href="/admin/logbooks" className="underline-offset-2 hover:underline">All logbooks</Link>
            {logbook.approved_at ? ` · approved ${formatWib(logbook.approved_at)}` : logbook.submitted_at ? ` · submitted ${formatWib(logbook.submitted_at)}` : ""}
          </>
        }
        actions={
          <>
            <Badge status={logbook.status} />
            {submitted ? (
              <>
                <ConfirmDialog
                  triggerLabel="Request changes"
                  triggerVariant="secondary"
                  title="Send this logbook back to the tutor"
                  description="The tutor can edit and submit again. You can flag the entries that need attention."
                  confirmLabel="Send back"
                  reasonLabel="Comment for the tutor"
                  action={requestLogbookChanges}
                  values={{ logbookId: logbook.id }}
                >
                  <fieldset className="space-y-1">
                    <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Flag entries (optional)</legend>
                    {entries.map((e) => (
                      <label key={e.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="flagged" value={e.id} />
                        {embedded(e.lesson) ? formatWib(embedded(e.lesson)!.starts_at) : ""} · {e.topic}
                      </label>
                    ))}
                  </fieldset>
                </ConfirmDialog>
                <ConfirmDialog
                  triggerLabel="Approve"
                  triggerVariant="primary"
                  title="Approve this logbook"
                  description={`This records ${formatRupiah(total)} of earnings for ${preview.length} lesson(s) (${tutorNames}) and makes the logbook visible to paid students. An approved logbook can no longer change.`}
                  confirmLabel="Approve"
                  action={approveLogbook}
                  values={{ logbookId: logbook.id }}
                />
              </>
            ) : null}
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {entries.length === 0 ? (
            <Card>
              <EmptyState title="No entries" />
            </Card>
          ) : (
            entries.map((e) => {
              const lesson = embedded(e.lesson);
              const history = revisions.filter((r) => r.entry_id === e.id);
              return (
                <Card key={e.id}>
                  <CardHeader
                    title={`${lesson ? formatWib(lesson.starts_at) : ""} · ${e.topic}`}
                    actions={e.edited_by_admin ? <Badge status="pending" label="Edited by admin" /> : undefined}
                  />
                  <dl className="space-y-3 p-4 text-sm">
                    <div>
                      <dt className="text-xs text-muted">Activities</dt>
                      <dd className="whitespace-pre-wrap">{e.activities}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Tutor observation</dt>
                      <dd className="whitespace-pre-wrap">{e.observation}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Future recommendation</dt>
                      <dd className="whitespace-pre-wrap">{e.recommendation}</dd>
                    </div>
                  </dl>
                  {history.length > 0 ? (
                    <details className="border-t border-cloud px-4 py-3 text-sm">
                      <summary className="cursor-pointer text-xs font-semibold">Previous versions ({history.length})</summary>
                      {history.map((r) => (
                        <div key={r.edited_at} className="mt-2 rounded-card bg-field p-3 text-xs">
                          <div className="font-semibold">{r.topic} <span className="font-normal text-muted">· replaced {formatWib(r.edited_at)}</span></div>
                          <p className="mt-1 whitespace-pre-wrap">{r.activities}</p>
                          <p className="mt-1 whitespace-pre-wrap">{r.observation}</p>
                          <p className="mt-1 whitespace-pre-wrap">{r.recommendation}</p>
                        </div>
                      ))}
                    </details>
                  ) : null}
                  {submitted ? (
                    <details className="border-t border-cloud px-4 py-3">
                      <summary className="cursor-pointer text-xs font-semibold">Fix a small mistake yourself</summary>
                      <ActionForm action={editLogbookEntry} className="mt-3 grid gap-3">
                        <input type="hidden" name="logbookId" value={logbook.id} />
                        <input type="hidden" name="entryId" value={e.id} />
                        <Field label="Topic">
                          <Input name="topic" required defaultValue={e.topic} />
                        </Field>
                        <Field label="Activities">
                          <Textarea name="activities" required defaultValue={e.activities} />
                        </Field>
                        <Field label="Tutor observation">
                          <Textarea name="observation" required defaultValue={e.observation} />
                        </Field>
                        <Field label="Future recommendation">
                          <Textarea name="recommendation" required defaultValue={e.recommendation} />
                        </Field>
                        <p className="text-xs text-muted">
                          The tutor&apos;s original text is kept and the entry is marked as edited. Problems with the schedule or the hours go back to the tutor with &ldquo;Request changes&rdquo;.
                        </p>
                        <div>
                          <SubmitButton variant="secondary">Save edit</SubmitButton>
                        </div>
                      </ActionForm>
                    </details>
                  ) : null}
                </Card>
              );
            })
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="What the tutor earns" />
            {preview.length === 0 ? (
              <EmptyState title="No lessons" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <Th>Lesson</Th>
                      <Th>Hours</Th>
                      <Th className="text-right">Amount</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((p) => (
                      <Tr key={p.lesson_id}>
                        <Td>
                          {formatWib(p.starts_at, { withDate: true })}
                          <div className="text-xs text-muted">{p.tutor_name} · {formatRupiah(p.rate_per_hour)}/h</div>
                        </Td>
                        <Td>{formatHours(p.minutes)}</Td>
                        <Td className="text-right">{formatRupiah(p.amount)}</Td>
                      </Tr>
                    ))}
                    <Tr>
                      <Td className="font-semibold">Total</Td>
                      <Td />
                      <Td className="text-right font-bold">{formatRupiah(total)}</Td>
                    </Tr>
                  </tbody>
                </table>
              </div>
            )}
            <p className="border-t border-cloud px-4 py-3 text-xs text-muted">
              Hours × the tutor rate in force when each lesson started. Approving more than once never adds earnings.
            </p>
          </Card>

          <Card>
            <CardHeader title="Review history" />
            {reviews.length === 0 ? (
              <p className="p-4 text-sm text-muted">Nothing yet.</p>
            ) : (
              <ul className="divide-y divide-cloud text-sm">
                {reviews.map((r) => (
                  <li key={r.id} className="px-4 py-2">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{r.action.replace(/_/g, " ")}</span>
                      <span className="text-xs text-muted">{formatWib(r.created_at)}</span>
                    </div>
                    {r.comment ? <p className="mt-1 text-muted">{r.comment}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
