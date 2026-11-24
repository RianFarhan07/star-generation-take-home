import { homeForRole, type Role } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { navBadges } from "@/lib/badgeCounts";
import { createClient } from "@/lib/supabase/server";
import { NAV } from "./nav";
import { Sidebar } from "./Sidebar";

const ROLE_LABEL: Record<Role, string> = { admin: "Admin", tutor: "Tutor", student: "Student" };

/** Layout shared by the three role areas: sidebar plus a content column. */
export async function AppShell({ role, fullName, children }: { role: Role; fullName: string; children: React.ReactNode }) {
  const supabase = await createClient();
  const [{ count }, badges] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    navBadges(supabase, role),
  ]);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar
        groups={NAV[role]}
        badges={badges}
        roleHome={homeForRole(role)}
        userName={fullName}
        roleLabel={ROLE_LABEL[role]}
        signOut={signOut}
        notificationsHref={`${homeForRole(role)}/notifications`}
        unread={count ?? 0}
      />
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
