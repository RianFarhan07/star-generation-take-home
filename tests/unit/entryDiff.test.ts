import { describe, expect, it } from "vitest";
import { entryChanges, shorten } from "../../src/lib/entryDiff";

const before = {
  topic: "Linear equations",
  activities: "Explained on the board.",
  observation: "Follows the method well.",
  recommendation: "Practise two examples.",
};

describe("what changed between two versions of an entry", () => {
  it("lists only the fields whose text differs, in the order of the form", () => {
    const after = { ...before, recommendation: "Practise five examples.", topic: "Linear equations (slope)" };
    expect(entryChanges(before, after)).toEqual([
      { key: "topic", label: "Topic", before: "Linear equations", after: "Linear equations (slope)" },
      { key: "recommendation", label: "Future recommendation", before: "Practise two examples.", after: "Practise five examples." },
    ]);
  });

  it("returns nothing when the text is the same, even if only the spacing around it differs", () => {
    expect(entryChanges(before, { ...before })).toEqual([]);
    expect(entryChanges(before, { ...before, topic: "  Linear equations  " })).toEqual([]);
  });
});

describe("shortening a text for a summary", () => {
  it("collapses whitespace and cuts long text with an ellipsis", () => {
    expect(shorten("one\n\n  two   three")).toBe("one two three");
    expect(shorten("a".repeat(70), 60)).toBe(`${"a".repeat(59)}…`);
    expect(shorten("short", 60)).toBe("short");
  });
});
