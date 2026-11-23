// The database raises errors like "CLASS_FULL: this class has no free seats". The code is the contract;
// this file turns it into a sentence a person can act on. Unknown errors never leak raw database text.

const GENERIC = "Something went wrong. Please try again.";

const BY_CODE: Record<string, string> = {
  NOT_ALLOWED: "You are not allowed to do that.",
  NOT_FOUND: "That item could not be found.",
  CLASS_FULL: "This class is full. All seats are taken.",
  ALREADY_ENROLLED: "You already have an enrollment in this class.",
  TERMS_REQUIRED: "You need to accept that there is no refund if you withdraw before enrolling.",
  CAPACITY_BELOW_SEATS: "Capacity cannot go below the number of seats already taken.",
  LESSON_OVERLAP: "That time overlaps another lesson of the same tutor.",
  LESSON_NOT_ENDED: "A logbook entry can only be written after the lesson has ended.",
  MONTH_LOCKED: "That month's logbook has been submitted, so its lessons can no longer change.",
  LOGBOOK_INCOMPLETE: "Every lesson of the month must have ended and have an entry before submitting.",
  HOURS_ALREADY_USED: "Lessons have already used hours from this invoice, so the payment cannot be reversed.",
  RENEWAL_OPEN: "There is already an open invoice for this enrollment.",
  PAYMENT_PENDING: "A payment is waiting for verification. The admin needs to review it first.",
};

// For these the database text is already the useful part ("capacity must be at least 1").
const KEEP_TEXT = new Set(["VALIDATION", "INVALID_STATE"]);

function sentence(text: string): string {
  const trimmed = text.trim().replace(/\.$/, "");
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1) + ".";
}

export function messageForError(err: { message?: string; code?: string }): string {
  if (err.code === "23P01") return BY_CODE.LESSON_OVERLAP;
  const match = /^([A-Z_]+): (.*)$/s.exec(err.message ?? "");
  if (!match) return GENERIC;
  const [, code, text] = match;
  if (KEEP_TEXT.has(code)) return sentence(text);
  // A recurring series names every date that clashes: keep that list.
  if (code === "LESSON_OVERLAP" && text.includes("dates overlap")) return sentence(text);
  return BY_CODE[code] ?? GENERIC;
}
