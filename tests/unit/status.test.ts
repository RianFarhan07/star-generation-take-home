import { describe, expect, it } from "vitest";
import { badgeFor } from "@/lib/status";

describe("badgeFor", () => {
  it("uses the brief's success colour for Paid and Approved", () => {
    expect(badgeFor("paid").variant).toBe("success");
    expect(badgeFor("approved").variant).toBe("success");
    expect(badgeFor("active").variant).toBe("success");
    expect(badgeFor("refunded").variant).toBe("success");
  });

  it("uses the destructive colour for overdue, rejected and out of hours", () => {
    expect(badgeFor("overdue").variant).toBe("danger");
    expect(badgeFor("rejected").variant).toBe("danger");
    expect(badgeFor("out_of_hours").variant).toBe("danger");
  });

  it("uses gold for things waiting on someone", () => {
    expect(badgeFor("awaiting_verification").variant).toBe("warning");
    expect(badgeFor("submitted").variant).toBe("warning");
    expect(badgeFor("low_hours").variant).toBe("warning");
    expect(badgeFor("pending").variant).toBe("warning");
  });

  it("uses muted grey for finished or inactive states", () => {
    expect(badgeFor("cancelled").variant).toBe("neutral");
    expect(badgeFor("expired").variant).toBe("neutral");
    expect(badgeFor("draft").variant).toBe("neutral");
    expect(badgeFor("something_new").variant).toBe("neutral");
  });

  it("turns a status code into a readable label", () => {
    expect(badgeFor("awaiting_verification").label).toBe("Awaiting verification");
    expect(badgeFor("out_of_hours").label).toBe("Out of hours");
    expect(badgeFor("paid").label).toBe("Paid");
  });
});
