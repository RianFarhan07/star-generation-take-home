import { describe, expect, it } from "vitest";
import { homeForRole, resolveRedirect } from "@/lib/auth";

describe("homeForRole", () => {
  it("sends each role to its own area", () => {
    expect(homeForRole("admin")).toBe("/admin");
    expect(homeForRole("tutor")).toBe("/tutor");
    expect(homeForRole("student")).toBe("/student");
  });
});

describe("resolveRedirect", () => {
  it("keeps a user out of another role's area", () => {
    expect(resolveRedirect("/admin/classes", "student")).toBe("/student");
    expect(resolveRedirect("/tutor", "admin")).toBe("/admin");
    expect(resolveRedirect("/student/invoices", "tutor")).toBe("/tutor");
  });

  it("sends a signed-out visitor to the login page", () => {
    expect(resolveRedirect("/tutor", null)).toBe("/login");
    expect(resolveRedirect("/admin/invoices/123", null)).toBe("/login");
    expect(resolveRedirect("/", null)).toBe("/login");
  });

  it("sends a signed-in user from the login page or the root to their home", () => {
    expect(resolveRedirect("/login", "tutor")).toBe("/tutor");
    expect(resolveRedirect("/", "student")).toBe("/student");
  });

  it("lets people through where they belong", () => {
    expect(resolveRedirect("/student/invoices", "student")).toBeNull();
    expect(resolveRedirect("/admin", "admin")).toBeNull();
    expect(resolveRedirect("/login", null)).toBeNull();
  });

  it("does not treat look-alike paths as protected areas", () => {
    expect(resolveRedirect("/administrator", "student")).toBeNull();
    expect(resolveRedirect("/studentship", null)).toBeNull();
  });
});
