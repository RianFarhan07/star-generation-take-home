import { ActionForm } from "@/components/ui/ActionForm";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/Card";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { rows } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { createClass } from "../../actions";

export default async function NewClassPage() {
  const supabase = await createClient();
  const tutors = rows<{ id: string; full_name: string }>(await supabase.from("profiles").select("id, full_name").eq("role", "tutor").order("full_name"));

  return (
    <>
      <PageHeader title="New class" subtitle="Rates are per hour. Students buy a package of hours at the student rate; the tutor earns the tutor rate for every lesson." />
      <Card className="max-w-2xl p-5">
        <ActionForm action={createClass} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Class name">
              <Input name="name" required placeholder="Math Grade 8 — Group A" />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Description">
              <Textarea name="description" />
            </Field>
          </div>
          <Field label="Tutor">
            <Select name="tutorId" required defaultValue="">
              <option value="" disabled>
                Choose a tutor
              </option>
              {tutors.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Capacity (students)">
            <Input name="capacity" type="number" min={1} defaultValue={2} required />
          </Field>
          <Field label="Package size (hours)" hint="What a student buys per invoice.">
            <Input name="packageHours" type="number" min={1} defaultValue={12} required />
          </Field>
          <div />
          <Field label="Student rate per hour (Rp)" hint="Hidden from tutors.">
            <Input name="studentRate" inputMode="numeric" defaultValue="150.000" required />
          </Field>
          <Field label="Tutor rate per hour (Rp)">
            <Input name="tutorRate" inputMode="numeric" defaultValue="100.000" required />
          </Field>
          <div className="sm:col-span-2">
            <SubmitButton>Create class</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
