import { describe, expect, it } from "vitest";
import { formatRupiah, parseRupiah } from "@/lib/money";

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
});
