import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/ActionForm";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, DefinitionList, EmptyState, PageHeader } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { embedded, LIVE_STATUSES, one, rows } from "@/lib/db";
import { formatRupiah } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { formatHours, formatWib } from "@/lib/time";
import { addLesson, cancelLesson, changeClassTutor, setClassCapacity, setClassRates, updateClassDetails } from "../../actions";

type ClassRow = { id: string; name: string; description: string; capacity: number; package_hours: number; tutor_id: string; tutor: { full_name: string } | { full_name: string }[] | null };
type RateRow = { effective_from: string; student_rate_per_hour: number; tutor_rate_per_hour: number };
type EnrollmentRow = { id: string; status: string; student: { full_name: string } | { full_name: string }[] | null };
type LessonRow = { id: string; starts_at: string; ends_at: string; duration_minutes: number; status: string; cancel_reason: string | null };

export default async function ClassDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const cls = one<ClassRow>(
    await supabase
      .from("classes")
      .select("id, name, description, capacity, package_hours, tutor_id, tutor:profiles!classes_tutor_id_fkey(full_name)")
      .eq("id", id)
      .maybeSingle(),
  );
  if (!cls) notFound();

  const [rates, enrollments, lessons, tutors] = await Promise.all([
    supabase.from("class_rates").select("effective_from, student_rate_per_hour, tutor_rate_per_hour").eq("class_id", id).order("effective_from", { ascending: false }),
    supabase.from("enrollments").select("id, status, student:profiles!enrollments_student_id_fkey(full_name)").eq("class_id", id).in("status", LIVE_STATUSES).order("created_at"),
    supabase.from("lessons").select("id, starts_at, ends_at, duration_minutes, status, cancel_reason").eq("class_id", id).order("starts_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name").eq("role", "tutor").order("full_name"),
  ]);
  const rateHistory = rows<RateRow>(rates);
  const now = new Date().toISOString();
  const current = rateHistory.find((r) => r.effective_from <= now) ?? rateHistory[0];
  const roster = rows<EnrollmentRow>(enrollments);
  const lessonList = rows<LessonRow>(lessons);
  const otherTutors = rows<{ id: string; full_name: string }>(tutors).filter((t) => t.id !== cls.tutor_id);

  return (
    <>
      <PageHeader
        title={cls.name}
        subtitle={`Tutor ${embedded(cls.tutor)?.full_name} · ${roster.length} of ${cls.capacity} seats taken · package ${cls.package_hours} h`}
        actions={
          <ConfirmDialog
            triggerLabel="Change tutor"
            title="Change the tutor of this class"
            description="Lessons that have already started stay with the current tutor, with their entries and earnings. Lessons that have not started move to the new tutor. If any of them clashes with the new tutor's own lessons, nothing changes."
            confirmLabel="Change tutor"
            action={changeClassTutor}
            values={{ classId: cls.id }}
          >
            <Field label="New tutor">
              <Select name="tutorId" required defaultValue="">
                <option value="" disabled>
                  Choose a tutor
                </option>
                {otherTutors.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name}
                  </option>
                ))}
              </Select>
            </Field>
          </ConfirmDialog>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Rates" />
          {current ? (
            <DefinitionList
              items={[
                { label: "Student rate (per hour)", value: formatRupiah(current.student_rate_per_hour) },
                { label: "Tutor rate (per hour)", value: formatRupiah(current.tutor_rate_per_hour) },
                { label: "Package price", value: formatRupiah(current.student_rate_per_hour * cls.package_hours) },
              ]}
            />
          ) : null}
          <ActionForm action={setClassRates} className="grid gap-3 border-t border-cloud p-4 sm:grid-cols-2">
            <input type="hidden" name="classId" value={cls.id} />
            <Field label="New student rate (Rp)">
              <Input name="studentRate" inputMode="numeric" required defaultValue={current ? String(current.student_rate_per_hour) : ""} />
            </Field>
            <Field label="New tutor rate (Rp)">
              <Input name="tutorRate" inputMode="numeric" required defaultValue={current ? String(current.tutor_rate_per_hour) : ""} />
            </Field>
            <p className="text-xs text-muted sm:col-span-2">
              Changes apply forward only: invoices already issued keep their price, and lessons already taught keep their rate.
            </p>
            <div className="sm:col-span-2">
              <SubmitButton>Save new rates</SubmitButton>
            </div>
          </ActionForm>
          {rateHistory.length > 1 ? (
            <div className="border-t border-cloud p-4">
              <p className="mb-2 text-xs font-medium text-muted">Rate history</p>
              <ul className="space-y-1 text-sm">
                {rateHistory.map((r) => (
                  <li key={r.effective_from} className="flex justify-between gap-3">
                    <span className="text-muted">{r.effective_from < "2001" ? "From the start" : `From ${formatWib(r.effective_from)}`}</span>
                    <span>
                      {formatRupiah(r.student_rate_per_hour)} / {formatRupiah(r.tutor_rate_per_hour)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Details" />
            <ActionForm action={updateClassDetails} className="grid gap-3 p-4">
              <input type="hidden" name="classId" value={cls.id} />
              <Field label="Class name">
                <Input name="name" required defaultValue={cls.name} />
              </Field>
              <Field label="Description">
                <Textarea name="description" defaultValue={cls.description} />
              </Field>
              <Field label="Package size (hours)" hint="Applies to new invoices.">
                <Input name="packageHours" type="number" min={1} required defaultValue={cls.package_hours} />
              </Field>
              <div>
                <SubmitButton>Save details</SubmitButton>
              </div>
            </ActionForm>
          </Card>
          <Card>
            <CardHeader title="Capacity" />
            <ActionForm action={setClassCapacity} className="grid gap-3 p-4">
              <input type="hidden" name="classId" value={cls.id} />
              <Field label="Seats" hint={`${roster.length} seat(s) are taken. Capacity cannot go below that.`}>
                <Input name="capacity" type="number" min={1} required defaultValue={cls.capacity} />
              </Field>
              <div>
                <SubmitButton>Save capacity</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-semibold">Roster</h2>
          {roster.length === 0 ? (
            <Card>
              <EmptyState title="No students yet" hint="Students appear here once they enroll." />
            </Card>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Student</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {roster.map((e) => (
                  <Tr key={e.id}>
                    <Td>{embedded(e.student)?.full_name}</Td>
                    <Td>
                      <Badge status={e.status} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">Add a lesson (WIB)</h2>
          <Card className="p-4">
            <ActionForm action={addLesson} className="grid gap-3 sm:grid-cols-3" resetOnSuccess>
              <input type="hidden" name="classId" value={cls.id} />
              <Field label="Date">
                <Input name="date" type="date" required />
              </Field>
              <Field label="Starts (WIB)">
                <Input name="start" type="time" required defaultValue="16:00" />
              </Field>
              <Field label="Ends (WIB)">
                <Input name="end" type="time" required defaultValue="17:30" />
              </Field>
              <div className="sm:col-span-3">
                <SubmitButton>Add lesson</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        </section>
      </div>

      <section className="mt-5">
        <h2 className="mb-2 text-sm font-semibold">Schedule</h2>
        {lessonList.length === 0 ? (
          <Card>
            <EmptyState title="No lessons scheduled" hint="Lessons can be added here or by the class's tutor." />
          </Card>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Length</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {lessonList.map((l) => (
                <Tr key={l.id}>
                  <Td>
                    {formatWib(l.starts_at)} – {formatWib(l.ends_at, { withDate: false })}
                  </Td>
                  <Td>{formatHours(l.duration_minutes)}</Td>
                  <Td>
                    <Badge status={l.status} />
                    {l.cancel_reason ? <span className="ml-2 text-xs text-muted">{l.cancel_reason}</span> : null}
                  </Td>
                  <Td className="text-right">
                    {l.status === "scheduled" ? (
                      <ConfirmDialog
                        triggerLabel="Cancel"
                        triggerVariant="destructive"
                        title="Cancel this lesson"
                        description="No hours are deducted from students and the tutor is not paid for a cancelled lesson. The lesson stays in the list with its reason."
                        confirmLabel="Cancel lesson"
                        confirmVariant="destructive"
                        reasonLabel="Reason"
                        action={cancelLesson}
                        values={{ classId: cls.id, lessonId: l.id }}
                      />
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </>
  );
}
