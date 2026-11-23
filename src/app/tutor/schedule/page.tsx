import { ActionForm } from "@/components/ui/ActionForm";
import { Badge } from "@/components/ui/Badge";
import { Card, EmptyState, PageHeader } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { embedded, rows } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { formatHours, formatWib, wibDateInput, wibTimeInput } from "@/lib/time";
import { addLesson, cancelLesson, updateLessonTime } from "../actions";

type LessonRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  status: string;
  cancel_reason: string | null;
  class: { name: string } | { name: string }[] | null;
  entries: { id: string }[];
};

export default async function SchedulePage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const [classesResult, lessonsResult] = await Promise.all([
    supabase.from("classes").select("id, name").eq("tutor_id", auth.user!.id).order("name"),
    supabase
      .from("lessons")
      .select("id, starts_at, ends_at, duration_minutes, status, cancel_reason, class:classes!lessons_class_id_fkey(name), entries:logbook_entries(id)")
      .order("starts_at", { ascending: false }),
  ]);
  const classes = rows<{ id: string; name: string }>(classesResult);
  const lessons = rows<LessonRow>(lessonsResult);
  const now = new Date().toISOString();
  const upcoming = lessons.filter((l) => l.ends_at > now).reverse();
  const past = lessons.filter((l) => l.ends_at <= now);

  const table = (list: LessonRow[]) => (
    <Table>
      <thead>
        <tr>
          <Th>When</Th>
          <Th>Class</Th>
          <Th>Length</Th>
          <Th>Status</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {list.map((l) => (
          <Tr key={l.id}>
            <Td>
              {formatWib(l.starts_at)} – {formatWib(l.ends_at, { withDate: false })}
            </Td>
            <Td>{embedded(l.class)?.name}</Td>
            <Td>{formatHours(l.duration_minutes)}</Td>
            <Td>
              <Badge status={l.status} />
              {l.entries.length > 0 ? <span className="ml-2 text-xs text-muted">entry written</span> : null}
              {l.cancel_reason ? <span className="ml-2 text-xs text-muted">{l.cancel_reason}</span> : null}
            </Td>
            <Td>
              {l.status === "scheduled" ? (
                <div className="flex justify-end gap-2">
                  {l.entries.length === 0 ? (
                    <ConfirmDialog
                      triggerLabel="Move"
                      title="Change the time of this lesson"
                      description="Times are WIB. A lesson that already has a logbook entry can no longer be moved."
                      confirmLabel="Save time"
                      action={updateLessonTime}
                      values={{ lessonId: l.id }}
                    >
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Field label="Date">
                          <Input name="date" type="date" required defaultValue={wibDateInput(l.starts_at)} />
                        </Field>
                        <Field label="Starts">
                          <Input name="start" type="time" required defaultValue={wibTimeInput(l.starts_at)} />
                        </Field>
                        <Field label="Ends">
                          <Input name="end" type="time" required defaultValue={wibTimeInput(l.ends_at)} />
                        </Field>
                      </div>
                    </ConfirmDialog>
                  ) : null}
                  <ConfirmDialog
                    triggerLabel="Cancel"
                    triggerVariant="destructive"
                    title="Cancel this lesson"
                    description="Students lose no hours and you are not paid for a cancelled lesson. If you wrote an entry for it, the entry is removed. Students see it as cancelled with your reason."
                    confirmLabel="Cancel lesson"
                    confirmVariant="destructive"
                    reasonLabel="Reason"
                    action={cancelLesson}
                    values={{ lessonId: l.id }}
                  />
                </div>
              ) : null}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );

  return (
    <>
      <PageHeader title="Schedule" subtitle="All times are WIB (UTC+7). Your lessons can never overlap, even across classes." />

      {classes.length > 0 ? (
        <Card className="mb-6 p-4">
          <h2 className="mb-3 text-sm font-semibold">Schedule a lesson</h2>
          <ActionForm action={addLesson} className="grid gap-3 sm:grid-cols-4" resetOnSuccess>
            <Field label="Class">
              <Select name="classId" required defaultValue={classes[0].id}>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date">
              <Input name="date" type="date" required />
            </Field>
            <Field label="Starts (WIB)">
              <Input name="start" type="time" required defaultValue="16:00" />
            </Field>
            <Field label="Ends (WIB)">
              <Input name="end" type="time" required defaultValue="17:30" />
            </Field>
            <div className="sm:col-span-4">
              <SubmitButton>Schedule lesson</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      ) : null}

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold">Upcoming</h2>
        {upcoming.length === 0 ? (
          <Card>
            <EmptyState title="No upcoming lessons" hint={classes.length ? "Schedule one above." : "You have no classes assigned yet."} />
          </Card>
        ) : (
          table(upcoming)
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Past</h2>
        {past.length === 0 ? (
          <Card>
            <EmptyState title="No past lessons" />
          </Card>
        ) : (
          table(past)
        )}
      </section>
    </>
  );
}
