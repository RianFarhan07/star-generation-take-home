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
 *
 * Only a number made of digits and thousands separators is regrouped (a "Rp" prefix and leading zeros are dropped,
 * comma thousands become dots, and a grouped number edited in the middle is regrouped: "1.0000" -> "10.000").
 * Everything else stays EXACTLY as typed so parseRupiah refuses it and the person sees the error, instead of the box
 * quietly turning it into a different amount: a decimal point or comma ("150000.5", "1.500,50"), a minus, letters,
 * mixed separators ("1.500,000") and a number still being typed ("1.", "1.5").
 *
 * `afterDelete` is for the moment right after a deletion in a number that was cleanly grouped: what is left is
 * regrouped ("1.800.00" -> "180.000"), because a deletion cannot create a decimal part.
 */
export function formatGrouped(input: string, options: { afterDelete?: boolean } = {}): string {
  const text = input.trim().replace(/^rp/i, "").trim();
  if (text === "") return "";
  if (!/^\d+([.,]\d+)*$/.test(text)) return input;
  if (text.includes(".") && text.includes(",")) return input;
  if (options.afterDelete) {
    if (text.includes(",")) return input;
  } else if (/[.,]\d{1,2}$/.test(text)) {
    return input; // a decimal part, or a thousands group still being typed
  }
  const digits = text.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
