import { describe, expect, it } from "vitest";
import { summarizeProgress } from "@/lib/progress";

const entry = (starts_at: string, topic: string, recommendation = `Next after ${topic}`) => ({ starts_at, topic, recommendation });

describe("summarizeProgress", () => {
  it("puts the latest lesson's recommendation first as what comes next", () => {
    const result = summarizeProgress([
      entry("2026-09-05T09:00:00Z", "Linear equations"),
      entry("2026-10-12T09:00:00Z", "Percentages"),
      entry("2026-09-26T09:00:00Z", "Word problems"),
    ]);
    expect(result.next).toEqual(entry("2026-10-12T09:00:00Z", "Percentages"));
  });

  it("lists every topic covered, newest first", () => {
    const result = summarizeProgress([
      entry("2026-09-05T09:00:00Z", "Linear equations"),
      entry("2026-10-12T09:00:00Z", "Percentages"),
      entry("2026-09-26T09:00:00Z", "Word problems"),
    ]);
    expect(result.topics.map((t) => t.topic)).toEqual(["Percentages", "Word problems", "Linear equations"]);
  });

  it("has nothing to show before any logbook is approved", () => {
    expect(summarizeProgress([])).toEqual({ next: null, topics: [] });
  });
});
