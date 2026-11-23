import { ActionForm } from "@/components/ui/ActionForm";
import { Field, Input } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { signIn } from "./actions";

const DEMO_LOGINS = [
  ["Admin", "admin@example.com"],
  ["Tutor (has the class)", "tutor.andi@example.com"],
  ["Tutor (no class)", "tutor.dewi@example.com"],
  ["Student (enrolled)", "student.budi@example.com"],
  ["Student", "student.sari@example.com"],
  ["Student", "student.citra@example.com"],
];

// The seeded demo logins are only listed on the page when this flag is on (set in .env.example for a local
// demo). A deployed copy should leave it off and change the seeded passwords.
const SHOW_DEMO_LOGINS = process.env.NEXT_PUBLIC_SHOW_DEMO_LOGINS === "true";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <div className="flex flex-col justify-center bg-navy px-8 py-10 text-white md:w-1/2 md:px-16">
        <div className="text-2xl font-bold">
          Star <span className="text-gold">Generation</span>
        </div>
        <p className="mt-3 max-w-sm text-white/75">Group classes, billing and logbooks in one place.</p>
      </div>

      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm">
          <h1 className="text-xl font-bold">Sign in</h1>
          <p className="mt-1 text-sm text-muted">Use the account you were given.</p>

          <ActionForm action={signIn} className="mt-6 space-y-4">
            <Field label="Email">
              <Input name="email" type="email" autoComplete="username" required />
            </Field>
            <Field label="Password">
              <Input name="password" type="password" autoComplete="current-password" required />
            </Field>
            <SubmitButton className="w-full">Sign in</SubmitButton>
          </ActionForm>

          {SHOW_DEMO_LOGINS ? (
            <details className="mt-8 rounded-card border border-cloud bg-white p-3 text-sm">
              <summary className="cursor-pointer font-semibold">Demo logins</summary>
              <p className="mt-2 text-xs text-muted">
                Seeded accounts for this demo. Password for all: <code className="font-semibold text-navy">Password123!</code>
              </p>
              <ul className="mt-2 space-y-1 text-xs">
                {DEMO_LOGINS.map(([role, email]) => (
                  <li key={email} className="flex justify-between gap-3">
                    <span className="text-muted">{role}</span>
                    <span className="font-medium">{email}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}
