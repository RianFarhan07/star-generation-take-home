import { describe, expect, it } from "vitest";
import { messageForError } from "@/lib/errors";

describe("messageForError", () => {
  it("turns each database error code into a plain sentence", () => {
    expect(messageForError({ message: "CLASS_FULL: this class has no free seats" })).toMatch(/full/i);
    expect(messageForError({ message: "ALREADY_ENROLLED: you already have an enrollment in this class" })).toMatch(/already/i);
    expect(messageForError({ message: "NOT_ALLOWED: only an admin can do this" })).toMatch(/not allowed/i);
    expect(messageForError({ message: "TERMS_REQUIRED: x" })).toMatch(/refund/i);
    expect(messageForError({ message: "LESSON_OVERLAP: x" })).toMatch(/overlap/i);
    expect(messageForError({ message: "MONTH_LOCKED: x" })).toMatch(/submitted/i);
  });

  it("keeps the specific text of validation-style errors", () => {
    expect(messageForError({ message: "VALIDATION: capacity must be at least 1" })).toBe("Capacity must be at least 1.");
    expect(messageForError({ message: "INVALID_STATE: this logbook has already been submitted" })).toBe("This logbook has already been submitted.");
  });

  it("maps the Postgres exclusion violation to an overlapping lesson", () => {
    expect(messageForError({ code: "23P01", message: "conflicting key value violates exclusion constraint" })).toMatch(/overlap/i);
  });

  it("falls back to a safe generic message for anything unexpected", () => {
    expect(messageForError({ message: "relation \"x\" does not exist" })).toBe("Something went wrong. Please try again.");
    expect(messageForError({})).toBe("Something went wrong. Please try again.");
  });
});

describe("messageForError for a recurring series", () => {
  it("keeps the list of clashing dates", () => {
    const message = messageForError({ message: "LESSON_OVERLAP: these dates overlap another lesson of the tutor: 15 Dec 2026, 22 Dec 2026" });
    expect(message).toMatch(/overlap/i);
    expect(message).toContain("15 Dec 2026, 22 Dec 2026");
  });

  it("keeps the generic overlap sentence when there is no list", () => {
    expect(messageForError({ message: "LESSON_OVERLAP: the tutor already has a lesson at that time" })).toBe(
      "That time overlaps another lesson of the same tutor.",
    );
  });
});
