// Money is stored as whole rupiah (bigint in Postgres). No decimals anywhere.

/** 150000 -> "Rp150,000" */
export function formatRupiah(amount: number | bigint): string {
  const sign = amount < 0 ? "-" : "";
  const abs = amount < 0 ? -amount : amount;
  return `${sign}Rp${abs.toLocaleString("en-US")}`;
}

/**
 * Reads an amount typed by a person: "150000", "150.000", "150,000", "Rp150.000", "Rp 150,000".
 * "." and "," are only accepted as thousands separators (groups of exactly three digits), and one
 * amount may use only one of them: "1.500,000" is ambiguous, so it is rejected instead of guessed.
 * Returns null for empty, negative, decimal or non-numeric input.
 */
export function parseRupiah(input: string): number | null {
  const cleaned = input.trim().replace(/^rp/i, "").trim();
  if (/^\d+$/.test(cleaned) || /^\d{1,3}(\.\d{3})+$/.test(cleaned) || /^\d{1,3}(,\d{3})+$/.test(cleaned)) {
    return Number(cleaned.replace(/[.,]/g, ""));
  }
  return null;
}

/**
 * What an amount box shows while a person types: digits grouped in threes with dots ("1800000" -> "1.800.000").
 * Anything that is not a digit is dropped (a "Rp" prefix, spaces, letters), and so are leading zeros. Comma
 * thousands ("150,000") become dots. A comma that is not a thousands separator ("1.500,50") is left exactly as typed,
 * so parseRupiah still refuses it instead of the box quietly turning it into a different amount.
 */
export function formatGrouped(input: string): string {
  const text = input.trim().replace(/^rp/i, "").trim();
  if (text.includes(",") && !/^\d{1,3}(,\d{3})+$/.test(text)) return input;
  const digits = text.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
