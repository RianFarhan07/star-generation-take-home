import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/ActionForm";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, PageHeader } from "@/components/ui/Card";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { one, rows } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { formatHours, formatMonth, formatWib, wibInputToUtcIso } from "@/lib/time";
import { saveEntry, submitLogbook } from "../../../actions";

type LessonRow = { id: string; starts_at: string; ends_at: string; duration_minutes: number; tutor_id: string };
type EntryRow = { id: string; lesson_id: string; topic: string; activities: string; observation: string; recommendation: string; edited_by_admin: boolean; updated_at: string };
type RevisionRow = { entry_id: string; topic: string; activities: string; observation: string; recommendation: string; edited_at: string };
type ReviewRow = { id: string; action: string; comment: string | null; entry_id: string | null; created_at: string };

function nextMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, "0")}`;
}

export default async function LogbookMonthPage({ params }: { params: Promise<{ classId: string; month: string }> }) {
  const { classId, month } = await params;
  if (!/^\d{4}-\d{2}$/.test(month)) notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const me = auth.user!.id;
  const cls = one<{ id: string; name: string; tutor_id: string }>(
    await supabase.from("classes").select("id, name, tutor_id").eq("id", classId).maybeSingle(),
  );
  if (!cls) notFound();

  const from = wibInputToUtcIso(`${month}-01`, "00:00");
  const to = wibInputToUtcIso(`${nextMonth(month)}-01`, "00:00");
  const lessons = rows<LessonRow>(
    await supabase
      .from("lessons")
      .select("id, starts_at, ends_at, duration_minutes, tutor_id")
      .eq("class_id", classId)
      .eq("status", "scheduled")
      .gte("starts_at", from)
      .lt("starts_at", to)
      .order("starts_at"),
  );
  const logbook = one<{ id: string; status: string }>(
    await supabase.from("logbooks").select("id, status").eq("class_id", classId).eq("month", `${month}-01`).maybeSingle(),
  );
  const lessonIds = lessons.map((l) => l.id);
  const entries = lessonIds.length
    ? rows<EntryRow>(
        await supabase
          .from("logbook_entries")
          .select("id, lesson_id, topic, activities, observation, recommendation, edited_by_admin, updated_at")
          .in("lesson_id", lessonIds),
      )
    : [];
  const entryOf = new Map(entries.map((e) => [e.lesson_id, e]));
  const revisions = entries.length
    ? rows<RevisionRow>(
        await supabase
          .from("logbook_entry_revisions")
          .select("entry_id, topic, activities, observation, recommendation, edited_at")
          .in("entry_id", entries.map((e) => e.id))
          .order("edited_at"),
      )
    : [];
  const reviews = logbook
    ? rows<ReviewRow>(await supabase.from("logbook_reviews").select("id, action, comment, entry_id, created_at").eq("logbook_id", logbook.id).order("created_at"))
    : [];

  const now = new Date().toISOString();
  const status = logbook?.status ?? "not_started";
  const editable = !logbook || logbook.status === "draft" || logbook.status === "changes_requested";
  const ended = lessons.filter((l) => l.ends_at <= now);
  const notEnded = lessons.length - ended.length;
  const missing = ended.filter((l) => !entryOf.has(l.id));
  const canSubmit = Boolean(logbook) && editable && notEnded === 0 && missing.length === 0 && entries.length > 0 && cls.tutor_id === me;
  const submitVisible = Boolean(logbook) && editable && cls.tutor_id === me;

  const lastRequest = [...reviews].reverse().find((r) => r.action === "changes_requested" && r.entry_id === null);
  const showRequest = status === "changes_requested" && lastRequest;
  // Entries the admin flagged in the latest round, with the moment of that round. A flag only matters while
  // the logbook is back with the tutor, and it stops being "needs attention" once the entry was edited after it.
  const flaggedAt = new Map<string, string>();
  if (showRequest) {
    for (const r of reviews) {
      if (r.action === "changes_requested" && r.entry_id && new Date(r.created_at) >= new Date(lastRequest.created_at)) {
        flaggedAt.set(r.entry_id, r.created_at);
      }
    }
  }
  const needsAttention = (entry: EntryRow) => {
    const at = flaggedAt.get(entry.id);
    return at !== undefined && new Date(entry.updated_at) <= new Date(at);
  };

  const missingMine = missing.filter((l) => l.tutor_id === me).length;
  const missingOthers = missing.length - missingMine;
  const isCurrentTutor = cls.tutor_id === me;

  let blockedReason: string | null = null;
  if (!logbook) blockedReason = "Write at least one entry first.";
  else if (status === "approved") blockedReason = "This logbook has been approved and can no longer change.";
  else if (!editable) blockedReason = "This logbook has been submitted and is waiting for the admin.";
  else if (!isCurrentTutor) blockedReason = "Write the entries for the lessons you taught. The class's current tutor submits the month once every lesson has an entry.";
  else if (notEnded > 0) blockedReason = `${notEnded} lesson(s) this month have not ended yet. Submit once they have ended and have entries, or cancel lessons that will not happen.`;
  else if (missingOthers > 0) {
    blockedReason = `${missingMine > 0 ? `${missingMine} of your lesson(s) and ` : ""}${missingOthers} lesson(s) taught by a previous tutor still need an entry. If that tutor cannot write it, ask the admin to cancel the lesson.`;
  } else if (missing.length > 0) blockedReason = `${missing.length} ended lesson(s) still need an entry.`;

  return (
    <>
      <PageHeader
        title={`${cls.name} — ${formatMonth(`${month}-01`)}`}
        subtitle={<Link href="/tutor/logbooks" className="underline-offset-2 hover:underline">All logbooks</Link>}
        actions={<Badge status={status} label={status === "not_started" ? "Not started" : undefined} />}
      />

      {showRequest ? (
        <div className="mb-5 rounded-card border border-gold bg-gold/15 p-4 text-sm">
          <p className="font-semibold">The admin asked for changes</p>
          <p className="mt-1">{lastRequest.comment}</p>
          <p className="mt-1 text-xs text-muted">Entries marked below need attention. Fix them and submit again.</p>
        </div>
      ) : null}

      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <p className="font-semibold">
              {entries.length} of {lessons.length} lesson(s) have an entry
            </p>
            {missing.length > 0 ? (
              <p className="mt-1 text-destructive">
                Missing: {missing.map((l) => formatWib(l.starts_at)).join(" · ")}
              </p>
            ) : null}
            {blockedReason ? <p className="mt-1 text-muted">{blockedReason}</p> : null}
          </div>
          {logbook && submitVisible ? (
            <ActionForm action={submitLogbook}>
              <input type="hidden" name="logbookId" value={logbook.id} />
              <input type="hidden" name="classId" value={classId} />
              <input type="hidden" name="month" value={month} />
              {canSubmit ? <SubmitButton>Finalise and submit</SubmitButton> : <button type="button" disabled className="rounded-card bg-navy px-3.5 py-2 text-sm font-semibold text-white opacity-50">Finalise and submit</button>}
            </ActionForm>
          ) : null}
        </div>
      </Card>

      {lessons.length === 0 ? (
        <Card>
          <p className="p-4 text-sm text-muted">There are no lessons in this class this month.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {lessons.map((l) => {
            const entry = entryOf.get(l.id);
            const isEnded = l.ends_at <= now;
            const history = entry ? revisions.filter((r) => r.entry_id === entry.id) : [];
            const mine = l.tutor_id === me;
            const flagNow = entry ? needsAttention(entry) : false;
            const fixedSinceFlag = entry ? flaggedAt.has(entry.id) && !flagNow : false;
            return (
              <Card key={l.id} className={flagNow ? "border-gold" : ""}>
                <CardHeader
                  title={`${formatWib(l.starts_at)} – ${formatWib(l.ends_at, { withDate: false })} · ${formatHours(l.duration_minutes)}`}
                  actions={
                    entry ? (
                      <span className="flex gap-2">
                        {flagNow ? <Badge status="changes_requested" label="Needs attention" /> : null}
                        {fixedSinceFlag ? <Badge status="pending" label="Updated since the request" /> : null}
                        {entry.edited_by_admin ? <Badge status="pending" label="Edited by admin" /> : null}
                        <Badge status="approved" label="Entry written" />
                      </span>
                    ) : isEnded ? (
                      <Badge status="overdue" label="Entry missing" />
                    ) : (
                      <Badge status="scheduled" label="Not ended yet" />
                    )
                  }
                />
                {!isEnded ? (
                  <p className="p-4 text-sm text-muted">
                    {mine ? "You can write the entry once the lesson has ended." : "This lesson was taught by another tutor and has not ended yet."}
                  </p>
                ) : editable && mine ? (
                  <ActionForm action={saveEntry} className="grid gap-3 p-4">
                    <input type="hidden" name="lessonId" value={l.id} />
                    <input type="hidden" name="classId" value={classId} />
                    <input type="hidden" name="month" value={month} />
                    <Field label="Topic">
                      <Input name="topic" required defaultValue={entry?.topic} />
                    </Field>
                    <Field label="Activities" hint="What happened in the lesson.">
                      <Textarea name="activities" required defaultValue={entry?.activities} />
                    </Field>
                    <Field label="Tutor observation">
                      <Textarea name="observation" required defaultValue={entry?.observation} />
                    </Field>
                    <Field label="Future recommendation" hint="What comes next.">
                      <Textarea name="recommendation" required defaultValue={entry?.recommendation} />
                    </Field>
                    <div>
                      <SubmitButton>{entry ? "Update entry" : "Save entry"}</SubmitButton>
                    </div>
                  </ActionForm>
                ) : entry ? (
                  <dl className="space-y-3 p-4 text-sm">
                    <div>
                      <dt className="text-xs text-muted">Topic</dt>
                      <dd className="font-medium">{entry.topic}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Activities</dt>
                      <dd className="whitespace-pre-wrap">{entry.activities}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Tutor observation</dt>
                      <dd className="whitespace-pre-wrap">{entry.observation}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Future recommendation</dt>
                      <dd className="whitespace-pre-wrap">{entry.recommendation}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="p-4 text-sm text-muted">
                    {mine
                      ? "No entry was written."
                      : "Waiting for the tutor who taught this lesson to write the entry. If they cannot, ask the admin to cancel the lesson."}
                  </p>
                )}
                {history.length > 0 ? (
                  <details className="border-t border-cloud px-4 py-3 text-sm">
                    <summary className="cursor-pointer text-xs font-semibold">What the admin changed (your original text)</summary>
                    {history.map((r) => (
                      <div key={r.edited_at} className="mt-2 rounded-card bg-field p-3 text-xs">
                        <div className="font-semibold">{r.topic}</div>
                        <p className="mt-1 whitespace-pre-wrap">{r.activities}</p>
                        <p className="mt-1 whitespace-pre-wrap">{r.observation}</p>
                        <p className="mt-1 whitespace-pre-wrap">{r.recommendation}</p>
                      </div>
                    ))}
                  </details>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
