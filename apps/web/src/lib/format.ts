/** A date in the CLIENT's time zone, e.g. "Jan 15, 2026". Due dates are calendar days there. */
export function formatDay(date: Date | null | undefined, timeZone = "UTC"): string | null {
  return date
    ? new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone }).format(date)
    : null;
}

/** "2h 15m" from minutes; "—" when there is nothing to show. */
export function formatEffort(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ");
}

export function formatDateTime(date: Date): string {
  return date.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
}
