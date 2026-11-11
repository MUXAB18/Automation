/** Calendar date arithmetic on plain "YYYY-MM-DD" strings (no time zones: a calendar day is a calendar day). */

export const VIEWS = ["day", "week", "month"] as const;
export type View = (typeof VIEWS)[number];

const DAY = 86_400_000;
const toDate = (d: string) => new Date(`${d}T00:00:00Z`);
const toStr = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => toStr(new Date(toDate(d).getTime() + n * DAY));
export const isDay = (v: string | undefined): v is string =>
  !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && toStr(toDate(v)) === v;

/** Monday of the week containing the day. */
export const weekStart = (d: string) => addDays(d, -((toDate(d).getUTCDay() + 6) % 7));

export function rangeFor(
  view: View,
  anchor: string,
): { from: string; to: string; days: string[]; monthOf: string } {
  const monthOf = anchor.slice(0, 7);
  let from = anchor;
  let to = anchor;
  if (view === "week") {
    from = weekStart(anchor);
    to = addDays(from, 6);
  } else if (view === "month") {
    const first = `${monthOf}-01`;
    const next = new Date(Date.UTC(+monthOf.slice(0, 4), +monthOf.slice(5, 7), 0)); // last day of month
    from = weekStart(first);
    to = addDays(weekStart(toStr(next)), 6);
  }
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return { from, to, days, monthOf };
}

/** The anchor day of the previous / next period. */
export function shift(view: View, anchor: string, dir: -1 | 1): string {
  if (view === "day") return addDays(anchor, dir);
  if (view === "week") return addDays(anchor, 7 * dir);
  const y = +anchor.slice(0, 4);
  const m = +anchor.slice(5, 7) - 1 + dir;
  return toStr(new Date(Date.UTC(y, m, 1)));
}

export const todayUtc = () => toStr(new Date());

export function titleFor(view: View, anchor: string): string {
  const f = (d: string, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", ...o }).format(toDate(d));
  if (view === "month") return f(anchor, { month: "long", year: "numeric" });
  if (view === "day")
    return f(anchor, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const start = weekStart(anchor);
  return `${f(start, { day: "numeric", month: "short" })} to ${f(addDays(start, 6), { day: "numeric", month: "short", year: "numeric" })}`;
}
