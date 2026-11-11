/** Time zone arithmetic with Intl only (no library): client-local wall time <-> UTC instant. */

const partsOf = (date: Date, timeZone: string) => {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year!, m: +p.month!, d: +p.day!, h: +p.hour!, mi: +p.minute!, s: +p.second! };
};

/** Minutes the zone is ahead of UTC at that instant (negative west of Greenwich). */
export function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const p = partsOf(at, timeZone);
  return Math.round(
    (Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(at.getTime() / 1000) * 1000) / 60_000,
  );
}

export const isValidTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export class LocalTimeError extends Error {}

/**
 * "2026-11-01T01:30" in "America/Toronto" -> the UTC instant.
 * A time that does not exist (spring-forward gap) is refused. A time that happens twice (autumn fall-back) means
 * the first occurrence, the earlier instant, so a post is never published an hour late.
 */
export function zonedLocalToUtc(local: string, timeZone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new LocalTimeError("Enter the date and time as YYYY-MM-DDTHH:mm");
  if (!isValidTimeZone(timeZone)) throw new LocalTimeError("Unknown time zone");
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const offsets = new Set([
    zoneOffsetMinutes(new Date(wall - 86_400_000), timeZone),
    zoneOffsetMinutes(new Date(wall + 86_400_000), timeZone),
  ]);
  const valid = [...offsets]
    .map((o) => new Date(wall - o * 60_000))
    .filter((t) => {
      const p = partsOf(t, timeZone);
      return p.y === y && p.m === mo && p.d === d && p.h === h && p.mi === mi;
    })
    .sort((a, b) => a.getTime() - b.getTime());
  if (valid.length === 0)
    throw new LocalTimeError(
      "That time does not exist in the client's time zone (clocks skip forward). Choose another time.",
    );
  return valid[0]!;
}

/** UTC instant -> "YYYY-MM-DDTHH:mm" in the zone (for form fields). */
export function utcToZonedLocal(at: Date, timeZone: string): string {
  const p = partsOf(at, timeZone);
  const z = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${z(p.y, 4)}-${z(p.m)}-${z(p.d)}T${z(p.h)}:${z(p.mi)}`;
}

/** The calendar day ("YYYY-MM-DD") an instant falls on in the zone. */
export const zonedDay = (at: Date, timeZone: string) => utcToZonedLocal(at, timeZone).slice(0, 10);
