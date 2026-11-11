import Link from "next/link";
import type { CalendarItem } from "@automation/db";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";

const CHANNEL: Record<string, string> = {
  website: "Web",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X",
  google_business: "Google",
  email: "Email",
};
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Chip({ item, compact }: { item: CalendarItem; compact?: boolean }) {
  return (
    <Link
      href={`/content/${item.id}`}
      className="block rounded-md border border-border bg-card px-2 py-1.5 text-xs shadow-sm transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="font-medium tabular-nums">{item.localTime}</span>
        <span className="text-muted-foreground">{CHANNEL[item.channel] ?? item.channel}</span>
      </span>
      <span className="mt-0.5 block truncate">{item.title}</span>
      {compact ? null : (
        <span className="mt-1 flex flex-wrap items-center gap-1">
          <StatusBadge kind="content" status={item.status} />
          {item.manual && ["scheduled", "approved"].includes(item.status) ? (
            <span className="text-muted-foreground">by hand</span>
          ) : null}
        </span>
      )}
    </Link>
  );
}

/** Month grid, week columns or a day list. Items sit on the day they fall on in their client's time zone. */
export function CalendarView({
  view,
  days,
  monthOf,
  today,
  items,
  multiClient,
}: {
  view: "day" | "week" | "month";
  days: string[];
  monthOf: string;
  today: string;
  items: CalendarItem[];
  multiClient: boolean;
}) {
  const byDay = new Map<string, CalendarItem[]>();
  for (const i of items) byDay.set(i.localDay, [...(byDay.get(i.localDay) ?? []), i]);
  const label = (d: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      day: "numeric",
      month: view === "month" ? undefined : "short",
      weekday: view === "month" ? undefined : "short",
    }).format(new Date(`${d}T00:00:00Z`));

  if (view === "day") {
    const list = byDay.get(days[0]!) ?? [];
    return (
      <div className="grid gap-2">
        {list.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Nothing scheduled for this day.
          </p>
        ) : (
          list.map((i) => (
            <div
              key={i.id}
              className="flex items-start gap-4 rounded-xl border border-border bg-card p-4 shadow-card"
            >
              <span className="w-14 text-sm font-semibold tabular-nums">{i.localTime}</span>
              <div className="min-w-0 flex-1">
                <Link href={`/content/${i.id}`} className="font-medium hover:underline">
                  {i.title}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {CHANNEL[i.channel] ?? i.channel}
                  {multiClient ? ` · ${i.clientName}` : ""} · {i.timezone}
                </p>
              </div>
              <StatusBadge kind="content" status={i.status} />
            </div>
          ))
        )}
      </div>
    );
  }

  return (
    <div
      role="grid"
      aria-label="Content calendar"
      className="overflow-hidden rounded-xl border border-border bg-card shadow-card"
    >
      <div
        role="row"
        className="grid grid-cols-7 [&>*]:min-w-0 border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground"
      >
        {WEEKDAYS.map((d) => (
          <div key={d} role="columnheader" className="px-2 py-2">
            {d}
          </div>
        ))}
      </div>
      <div className={cn("grid grid-cols-7 [&>*]:min-w-0", view === "month" ? "auto-rows-fr" : "")}>
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const outside = view === "month" && !d.startsWith(monthOf);
          return (
            <div
              key={d}
              role="gridcell"
              aria-label={d}
              className={cn(
                "min-h-28 min-w-0 overflow-hidden border-b border-r border-border p-1.5 last:border-r-0",
                outside && "bg-muted/30 text-muted-foreground",
                view === "week" && "min-h-64",
              )}
            >
              <p
                className={cn(
                  "mb-1 text-xs",
                  d === today &&
                    "inline-flex rounded-full bg-primary px-1.5 font-semibold text-primary-foreground",
                )}
              >
                {label(d)}
              </p>
              <div className="grid gap-1">
                {(view === "month" ? list.slice(0, 3) : list).map((i) => (
                  <Chip key={i.id} item={i} compact={view === "month"} />
                ))}
                {view === "month" && list.length > 3 ? (
                  <Link
                    href={`/content?view=day&date=${d}`}
                    className="text-xs text-primary hover:underline"
                  >
                    +{list.length - 3} more
                  </Link>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
