import { cn } from "@/lib/utils";

export type DonutSegment = { key: string; label: string; value: number; color: string };

/**
 * Ring chart of real counts. Server-rendered SVG: no JavaScript, accessible via the legend table.
 * Colors are CSS variables so both themes work.
 */
export function DonutChart({
  segments,
  centerLabel,
  className,
}: {
  segments: DonutSegment[];
  centerLabel: string;
  className?: string;
}) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  const R = 52;
  const C = 2 * Math.PI * R;
  const gap = total > 0 && segments.filter((s) => s.value > 0).length > 1 ? 2.5 : 0;
  let offset = 0;
  return (
    <div className={cn("flex flex-col items-center gap-5", className)}>
      <div className="relative size-48">
        <svg
          viewBox="0 0 140 140"
          className="size-full -rotate-90"
          role="img"
          aria-label={`${centerLabel}: ${total}`}
        >
          <circle cx="70" cy="70" r={R} fill="none" strokeWidth="14" className="stroke-muted" />
          {total > 0
            ? segments
                .filter((s) => s.value > 0)
                .map((s) => {
                  const len = (s.value / total) * C;
                  const el = (
                    <circle
                      key={s.key}
                      cx="70"
                      cy="70"
                      r={R}
                      fill="none"
                      strokeWidth="14"
                      strokeLinecap="round"
                      stroke={s.color}
                      strokeDasharray={`${Math.max(len - gap, 0.5)} ${C}`}
                      strokeDashoffset={-offset}
                    />
                  );
                  offset += len;
                  return el;
                })
            : null}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold tabular-nums tracking-tight">{total}</span>
          <span className="text-xs text-muted-foreground">{centerLabel}</span>
        </div>
      </div>
      <ul className="w-full space-y-2.5">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2.5">
              <span className="size-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
              {s.label}
            </span>
            <span className="flex items-center gap-2 tabular-nums">
              <span className="font-semibold">{s.value}</span>
              <span className="w-10 rounded-md bg-muted px-1.5 py-0.5 text-center text-[11px] font-medium text-muted-foreground">
                {total ? Math.round((s.value / total) * 100) : 0}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type WeekBar = { weekStart: string; done: number; open: number };

const label = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/** Grouped bars: finished (soft) and still open (brand) per week. Hover or focus a column for the numbers. */
export function WeeklyBars({ weeks, currentWeek }: { weeks: WeekBar[]; currentWeek: string }) {
  const max = Math.max(4, ...weeks.flatMap((w) => [w.done, w.open]));
  const top = Math.ceil(max / 4) * 4;
  const ticks = [top, (top * 3) / 4, top / 2, top / 4, 0];
  return (
    <figure>
      <div className="flex gap-3">
        <div
          className="flex h-52 flex-col justify-between pb-0 text-[11px] tabular-nums text-muted-foreground"
          aria-hidden
        >
          {ticks.map((t) => (
            <span key={t}>{Math.round(t)}</span>
          ))}
        </div>
        <div className="relative flex-1">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 flex h-52 flex-col justify-between"
            aria-hidden
          >
            {ticks.map((t) => (
              <div key={t} className="h-px bg-border" />
            ))}
          </div>
          <div className="relative flex h-52 items-end justify-between gap-1.5">
            {weeks.map((w) => (
              <div
                key={w.weekStart}
                tabIndex={0}
                className="group relative flex h-full flex-1 items-end justify-center gap-1 rounded-lg outline-none focus-visible:bg-accent"
              >
                <div
                  className="w-full max-w-3 rounded-full bg-border"
                  style={{ height: `${(w.done / top) * 100}%`, minHeight: w.done ? 6 : 0 }}
                />
                <div
                  className="w-full max-w-3 rounded-full bg-primary"
                  style={{ height: `${(w.open / top) * 100}%`, minHeight: w.open ? 6 : 0 }}
                />
                <div
                  role="tooltip"
                  className="pointer-events-none absolute -top-2 left-1/2 z-10 hidden w-max -translate-x-1/2 -translate-y-full rounded-xl bg-foreground px-3 py-2 text-xs text-background shadow-lg group-hover:block group-focus-visible:block"
                >
                  <p className="font-semibold">Week of {label(w.weekStart)}</p>
                  <p className="mt-1 flex items-center gap-2">
                    <span className="size-2 rounded-full bg-primary" />
                    {w.open} open
                  </p>
                  <p className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-border" />
                    {w.done} done
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div
            className="mt-3 flex justify-between gap-1.5 text-[11px] text-muted-foreground"
            aria-hidden
          >
            {weeks.map((w) => (
              <span
                key={w.weekStart}
                className={cn(
                  "flex-1 text-center",
                  w.weekStart === currentWeek && "font-semibold text-primary",
                )}
              >
                {label(w.weekStart)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="mt-4 flex items-center gap-5 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-primary" />
          Still open
        </span>
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-border" />
          Done
        </span>
        <span className="ml-auto">By due date, weeks starting Monday</span>
      </figcaption>
      <table className="sr-only">
        <caption>Tasks due per week</caption>
        <thead>
          <tr>
            <th>Week of</th>
            <th>Open</th>
            <th>Done</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.weekStart}>
              <td>{w.weekStart}</td>
              <td>{w.open}</td>
              <td>{w.done}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
