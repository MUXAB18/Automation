/**
 * Date helpers that respect a client's time zone. Due dates are chosen as a calendar day ("Friday");
 * the task becomes overdue when that day has ended where the client is, not where the server is.
 */

/** Offset of `tz` from UTC at `instant`, in minutes (positive east of Greenwich). */
function offsetMinutes(instant: Date, tz: string): number {
  const whole = new Date(Math.floor(instant.getTime() / 1000) * 1000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(whole)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    +parts.year!,
    +parts.month! - 1,
    +parts.day!,
    +parts.hour!,
    +parts.minute!,
    +parts.second!,
  );
  return Math.round((asUtc - whole.getTime()) / 60000);
}

/** The last millisecond of calendar day `YYYY-MM-DD` in `tz`, as a UTC instant. */
export function endOfDayInTimeZone(date: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
  // Two passes settle the offset even when the day contains a daylight-saving change.
  const first = guess - offsetMinutes(new Date(guess), tz) * 60000;
  return new Date(guess - offsetMinutes(new Date(first), tz) * 60000);
}

/** The first millisecond of calendar day `YYYY-MM-DD` in `tz`. */
export function startOfDayInTimeZone(date: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const first = guess - offsetMinutes(new Date(guess), tz) * 60000;
  return new Date(guess - offsetMinutes(new Date(first), tz) * 60000);
}

/** The calendar day (`YYYY-MM-DD`) an instant falls on in `tz`. */
export function dateInTimeZone(instant: Date, tz: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(instant)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

/** All `YYYY-MM-DD` days of a month (`YYYY-MM`), in order. */
export function daysOfMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

export const isMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
