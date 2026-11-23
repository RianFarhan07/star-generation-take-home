// Money is stored as whole rupiah (bigint in Postgres). No decimals anywhere.

/** 150000 -> "Rp150,000" */
export function formatRupiah(amount: number | bigint): string {
  const sign = amount < 0 ? "-" : "";
  const abs = amount < 0 ? -amount : amount;
  return `${sign}Rp${abs.toLocaleString("en-US")}`;
}

/**
 * Reads an amount typed by a person: "150000", "150.000", "150,000", "Rp150.000", "Rp 150,000".
 * "." and "," are only accepted as thousands separators (groups of exactly three digits).
 * Returns null for empty, negative, decimal or non-numeric input.
 */
export function parseRupiah(input: string): number | null {
  const cleaned = input.trim().replace(/^rp/i, "").trim();
  if (/^\d+$/.test(cleaned) || /^\d{1,3}([.,]\d{3})+$/.test(cleaned)) {
    return Number(cleaned.replace(/[.,]/g, ""));
  }
  return null;
}
