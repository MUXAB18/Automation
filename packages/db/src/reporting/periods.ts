import { LocalTimeError, zonedDay, zonedLocalToUtc } from "../time-zone";
import { addDays, daysBetween } from "./metrics";

/**
 * Reporting periods are consecutive windows of `intervalDays` calendar days, counted from an anchor day in the CLIENT's
 * time zone (default 15 days). A period is generated the morning after it ends, at the schedule's local hour. All
 * arithmetic is on calendar days; only the run instant is converted to UTC, once, with the client's zone.
 */
export type Period = { index: number; start: string; end: string };

export const DEFAULT_INTERVAL_DAYS = 15;

export function periodAt(anchor: string, intervalDays: number, index: number): Period {
  const start = addDays(anchor, index * intervalDays);
  return { index, start, end: addDays(start, intervalDays - 1) };
}

/** When a period is due: the local `hour` on the day after it ends. A clock time skipped by daylight saving moves an hour on. */
export function runAtFor(period: Period, hour: number, timeZone: string): Date {
  const day = addDays(period.end, 1);
  for (const h of [hour, hour + 1, hour + 2]) {
    try {
      return zonedLocalToUtc(`${day}T${String(h % 24).padStart(2, "0")}:00`, timeZone);
    } catch (e) {
      if (!(e instanceof LocalTimeError)) throw e;
    }
  }
  throw new LocalTimeError("No valid run time");
}

/** The latest period whose run time has passed, or null before the first one is due. */
export function latestDuePeriod(
  anchor: string,
  intervalDays: number,
  hour: number,
  timeZone: string,
  now: Date,
): Period | null {
  const today = zonedDay(now, timeZone);
  if (today < anchor) return null;
  let index = Math.floor((daysBetween(anchor, today) - 1) / intervalDays);
  for (; index >= 0; index--) {
    const p = periodAt(anchor, intervalDays, index);
    if (runAtFor(p, hour, timeZone).getTime() <= now.getTime()) return p;
  }
  return null;
}

/** The first period whose run time is still in the future. */
export function nextPeriodAfter(
  anchor: string,
  intervalDays: number,
  hour: number,
  timeZone: string,
  now: Date,
): { period: Period; runAt: Date } {
  const due = latestDuePeriod(anchor, intervalDays, hour, timeZone, now);
  let index = due ? due.index + 1 : 0;
  for (;;) {
    const period = periodAt(anchor, intervalDays, index++);
    const runAt = runAtFor(period, hour, timeZone);
    if (runAt.getTime() > now.getTime()) return { period, runAt };
  }
}

/** The last full period of `intervalDays` days that ended before today, in the client's time zone (for a manual report). */
export function lastFullPeriod(
  intervalDays: number,
  timeZone: string,
  now: Date,
): { start: string; end: string } {
  const end = addDays(zonedDay(now, timeZone), -1);
  return { start: addDays(end, -(intervalDays - 1)), end };
}
