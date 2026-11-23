import { AppShell } from "@/components/shell/AppShell";
import { requireRole } from "@/lib/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("admin");
  return (
    <AppShell role="admin" fullName={session.fullName}>
      {children}
    </AppShell>
  );
}
