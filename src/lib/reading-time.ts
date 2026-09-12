/** Calendar semantics for reported readings. Relative dates use the device's
 * current IANA timezone, never the server's timezone or a guessed clock hour. */
export type ReadingTimeInput = {
  day?: "now" | "today" | "yesterday" | "date" | null;
  date?: string | null;
  period?: "day" | "morning" | "afternoon" | "evening" | null;
  exactTime?: string | null;
};

export function readingTimezone(value: unknown): string {
  if (typeof value !== "string" || value.length > 100) return "UTC";
  try { return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone; }
  catch { return "UTC"; }
}

export function readingLocalDate(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(instant);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function validReadingDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function resolveReadingTime(input: ReadingTimeInput | null | undefined, receivedAt: Date, timezoneValue: unknown) {
  if (!Number.isFinite(receivedAt.getTime())) throw new Error("Invalid message timestamp.");
  const timezone = readingTimezone(timezoneValue);
  const today = readingLocalDate(receivedAt, timezone);
  if (input?.exactTime) {
    // A bare local wall clock is ambiguous at DST transitions. Only accept an
    // explicit offset, and only when the user actually supplied that precision.
    if (!/T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(input.exactTime)) {
      throw new Error("An exact reading time requires a timezone offset.");
    }
    const date = new Date(input.exactTime);
    if (!validReadingDate(input.exactTime.slice(0, 10)) || !Number.isFinite(date.getTime()) || date.getTime() > receivedAt.getTime() + 60_000) {
      throw new Error("Reading time must be a valid past time.");
    }
    return { occurredAt: date.toISOString(), localDate: readingLocalDate(date, timezone), timezone, precision: "exact" as const };
  }
  const day = input?.day ?? (input?.period ? "today" : "now");
  if (day === "now") {
    if (input?.period || input?.date) throw new Error("Use today or a date for an approximate reading time.");
    return { occurredAt: receivedAt.toISOString(), localDate: today, timezone, precision: "exact" as const };
  }
  let localDate = today;
  if (day === "yesterday") {
    // Calendar subtraction, not 24 hours from the request (23/25-hour DST days).
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    localDate = date.toISOString().slice(0, 10);
  } else if (day === "date") {
    if (!input?.date || !validReadingDate(input.date)) throw new Error("Supply a valid calendar date for the reading.");
    localDate = input.date;
  }
  if (localDate > today) throw new Error("A completed reading cannot be in the future.");
  return { localDate, timezone, precision: input?.period ?? "day" as const };
}
