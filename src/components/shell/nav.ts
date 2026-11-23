import type { Role } from "@/lib/auth";

export type NavGroup = { label: string; items: { href: string; label: string }[] };

// Sidebar menus per role, grouped under small labels.
export const NAV: Record<Role, NavGroup[]> = {
  admin: [
    {
      label: "Operations",
      items: [
        { href: "/admin", label: "Overview" },
        { href: "/admin/classes", label: "Classes" },
        { href: "/admin/students", label: "Students" },
        { href: "/admin/logbooks", label: "Logbooks" },
      ],
    },
    {
      label: "Finance",
      items: [
        { href: "/admin/invoices", label: "Invoices" },
        { href: "/admin/refunds", label: "Refunds" },
      ],
    },
  ],
  tutor: [
    {
      label: "Teaching",
      items: [
        { href: "/tutor", label: "My classes" },
        { href: "/tutor/schedule", label: "Schedule" },
        { href: "/tutor/logbooks", label: "Logbooks" },
      ],
    },
    { label: "Pay", items: [{ href: "/tutor/earnings", label: "Earnings" }] },
  ],
  student: [
    {
      label: "Learning",
      items: [
        { href: "/student", label: "My classes" },
        { href: "/student/classes", label: "Browse classes" },
      ],
    },
    { label: "Billing", items: [{ href: "/student/invoices", label: "Invoices" }] },
  ],
};
