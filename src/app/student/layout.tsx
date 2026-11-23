import { AppShell } from "@/components/shell/AppShell";
import { requireRole } from "@/lib/session";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("student");
  return (
    <AppShell role="student" fullName={session.fullName}>
      {children}
    </AppShell>
  );
}
