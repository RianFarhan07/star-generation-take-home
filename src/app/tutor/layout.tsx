import { AppShell } from "@/components/shell/AppShell";
import { requireRole } from "@/lib/session";

export default async function TutorLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("tutor");
  return (
    <AppShell role="tutor" fullName={session.fullName}>
      {children}
    </AppShell>
  );
}
