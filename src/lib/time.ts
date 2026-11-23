// All stored times are timestamptz (absolute instants). WIB (Asia/Jakarta, UTC+7, no DST)
// only exists at the edges: reading form input and showing times to people.

const WIB_OFFSET_MINUTES = 7 * 60;
const WIB_ZONE = "Asia/Jakarta";

/** Reads a date ("2026-11-24") and time ("16:00") typed in a form as WIB and returns the UTC instant. */
export function wibInputToUtcIso(date: string, time: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new RangeError(`Invalid WIB date/time: "${date}" "${time}"`);
  }
  const instant = new Date(`${date}T${time}:00+07:00`);
  // JS rolls impossible dates over (2026-02-31 becomes 3 March), so check the wall clock round-trips.
  const roundTrip = Number.isNaN(instant.getTime())
    ? null
    : new Date(instant.getTime() + WIB_OFFSET_MINUTES * 60_000).toISOString().slice(0, 16);
  if (roundTrip !== `${date}T${time}`) {
    throw new RangeError(`Invalid WIB date/time: "${date}" "${time}"`);
  }
  return instant.toISOString();
}

/** First day of the WIB month that contains the instant, e.g. "2026-11-01". Matches lesson_month() in SQL. */
export function wibMonthStart(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() + WIB_OFFSET_MINUTES * 60_000);
  return `${shifted.toISOString().slice(0, 7)}-01`;
}

/** "Tue, 24 Nov 2026 · 16:00 WIB" (or "16:00 WIB" with withDate: false). */
export function formatWib(iso: string, opts: { withDate?: boolean } = {}): string {
  const { withDate = true } = opts;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: WIB_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const clock = `${get("hour")}:${get("minute")} WIB`;
  if (!withDate) return clock;
  return `${get("weekday")}, ${get("day")} ${get("month")} ${get("year")} · ${clock}`;
}

/** Date part for form inputs in WIB, "2026-11-24". */
export function wibDateInput(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() + WIB_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** Time part for form inputs in WIB, "16:00". */
export function wibTimeInput(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() + WIB_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(11, 16);
}

/** "2026-11-01" (a logbook's month) -> "November 2026". */
export function formatMonth(firstDay: string): string {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${firstDay}T00:00:00Z`));
}

/** 90 -> "1.5 h", 720 -> "12 h". */
export function formatHours(minutes: number): string {
  return `${Number((minutes / 60).toFixed(2))} h`;
}
