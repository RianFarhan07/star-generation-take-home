import { describe, expect, it } from "vitest";
import { formatGrouped, formatRupiah, parseRupiah } from "@/lib/money";

describe("formatRupiah", () => {
  it("formats with comma thousands and no decimals", () => {
    expect(formatRupiah(150000)).toBe("Rp150,000");
    expect(formatRupiah(1800000)).toBe("Rp1,800,000");
    expect(formatRupiah(0)).toBe("Rp0");
  });

  it("accepts bigint values coming from the database", () => {
    expect(formatRupiah(1575000n)).toBe("Rp1,575,000");
  });
});

describe("parseRupiah", () => {
  it("reads the ways an admin may type the same amount", () => {
    for (const s of ["150.000", "150,000", "Rp150.000", "Rp 150,000", "rp150000", "150000", " 150000 "]) {
      expect(parseRupiah(s)).toBe(150000);
    }
  });

  it("rejects empty, negative, decimal and non-numeric input", () => {
    for (const s of ["", "   ", "-5", "150000.5", "1,5", "abc", "Rp"]) {
      expect(parseRupiah(s)).toBeNull();
    }
  });

  it("rejects amounts that mix '.' and ',' because their meaning is ambiguous", () => {
    for (const s of ["1.500,000", "1,500.000", "1.500.000,000"]) {
      expect(parseRupiah(s)).toBeNull();
    }
    expect(parseRupiah("1.500.000")).toBe(1500000);
    expect(parseRupiah("1,500,000")).toBe(1500000);
  });
});

describe("formatGrouped (what the amount boxes show while typing)", () => {
  it("groups the digits in threes with dots", () => {
    expect(formatGrouped("100000")).toBe("100.000");
    expect(formatGrouped("1800000")).toBe("1.800.000");
    expect(formatGrouped("500")).toBe("500");
    expect(formatGrouped("")).toBe("");
  });

  it("drops everything that is not a digit, including a Rp prefix and leading zeros", () => {
    expect(formatGrouped("Rp 150000")).toBe("150.000");
    expect(formatGrouped("12abc")).toBe("12");
    expect(formatGrouped("0012")).toBe("12");
    expect(formatGrouped("000")).toBe("0");
    expect(formatGrouped("abc")).toBe("");
  });

  it("turns comma thousands into dots but leaves anything with a decimal comma alone, so it is still refused", () => {
    expect(formatGrouped("150,000")).toBe("150.000");
    expect(formatGrouped("1.500,50")).toBe("1.500,50");
    expect(formatGrouped("1,5")).toBe("1,5");
  });

  it("is something parseRupiah reads back to the same amount", () => {
    expect(parseRupiah(formatGrouped("1800000"))).toBe(1800000);
    expect(parseRupiah(formatGrouped("Rp 100000"))).toBe(100000);
  });
});
