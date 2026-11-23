import { describe, expect, it } from "vitest";
import { formatHours, formatMonth, formatWib, wibInputToUtcIso, wibMonthStart } from "@/lib/time";

// The server runs in UTC and a browser can be anywhere: WIB must not depend on the host zone.
process.env.TZ = "America/New_York";

describe("wibInputToUtcIso", () => {
  it("reads a form date and time as WIB (UTC+7)", () => {
    expect(wibInputToUtcIso("2026-11-24", "16:00")).toBe("2026-11-24T09:00:00.000Z");
  });

  it("crosses the UTC date boundary correctly at 06:00 WIB on the 1st", () => {
    expect(wibInputToUtcIso("2026-11-01", "06:00")).toBe("2026-10-31T23:00:00.000Z");
  });

  it("rejects dates that do not exist", () => {
    expect(() => wibInputToUtcIso("2026-02-31", "10:00")).toThrow(RangeError);
    expect(() => wibInputToUtcIso("24/11/2026", "10:00")).toThrow(RangeError);
    expect(() => wibInputToUtcIso("2026-11-24", "25:00")).toThrow(RangeError);
  });
});

describe("wibMonthStart", () => {
  it("puts 23:00 UTC on the last day of October into the WIB November", () => {
    expect(wibMonthStart("2026-10-31T23:00:00.000Z")).toBe("2026-11-01");
  });

  it("keeps 16:59 UTC on the last day of October in October", () => {
    expect(wibMonthStart("2026-10-31T16:59:00.000Z")).toBe("2026-10-01");
  });
});

describe("formatWib", () => {
  it("shows the WIB wall clock with the WIB label", () => {
    expect(formatWib("2026-11-24T09:00:00.000Z")).toBe("Tue, 24 Nov 2026 · 16:00 WIB");
  });

  it("can show the time only", () => {
    expect(formatWib("2026-11-24T09:00:00.000Z", { withDate: false })).toBe("16:00 WIB");
  });
});

describe("formatHours", () => {
  it("formats minutes as hours without trailing zeros", () => {
    expect(formatHours(90)).toBe("1.5 h");
    expect(formatHours(720)).toBe("12 h");
    expect(formatHours(45)).toBe("0.75 h");
    expect(formatHours(0)).toBe("0 h");
  });
});

describe("formatMonth", () => {
  it("names the month of a logbook's first day", () => {
    expect(formatMonth("2026-11-01")).toBe("November 2026");
    expect(formatMonth("2027-01-01")).toBe("January 2027");
  });
});
