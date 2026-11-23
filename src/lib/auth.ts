// Pure routing rules (no Next.js imports) so they can be unit-tested. The proxy and the layouts use them.
// This is for a friendly experience only: the database still refuses anything a role may not do.

export type Role = "admin" | "tutor" | "student";

const ROLES: readonly string[] = ["admin", "tutor", "student"];

export function homeForRole(role: Role): string {
  return `/${role}`;
}

/** Where a request for `pathname` should be redirected for this role, or null when it may go through. */
export function resolveRedirect(pathname: string, role: Role | null): string | null {
  if (pathname === "/") return role ? homeForRole(role) : "/login";
  if (pathname === "/login" || pathname.startsWith("/login/")) return role ? homeForRole(role) : null;

  const area = pathname.split("/")[1];
  if (ROLES.includes(area)) {
    if (!role) return "/login";
    if (role !== area) return homeForRole(role);
  }
  return null;
}
