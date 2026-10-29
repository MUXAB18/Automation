import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getCalendar, isMonth } from "@automation/db";
import { SampleBanner } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import { getScope } from "@/lib/scope";
import { str, type RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Task calendar" };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const shift = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export default async function CalendarPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const actor = await requireActor();
  const raw = await searchParams;
  const scope = await getScope(actor);
  const requested = str(raw.month, 7);
  const today = new Date();
  const month =
    requested && isMonth(requested)
      ? requested
      : `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;
  const cal = await getCalendar(actor, month, {
    clientId: scope.clientId,
    projectId: scope.projectId,
    open: str(raw.show) !== "all",
  });
  const [y, m] = month.split("-").map(Number) as [number, number];
  const monthName = new Intl.DateTimeFormat("en-CA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday first
  const todayKey = today.toISOString().slice(0, 10);
  const all = [...cal.byDay.values()].flat();
  const href = (mo: string) =>
    `/tasks/calendar?month=${mo}${str(raw.show) === "all" ? "&show=all" : ""}`;

  return (
    <>
      <SampleBanner show={all.some((t) => t.isSample)} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href={href(shift(month, -1))}
            aria-label="Previous month"
            className="inline-flex size-9 items-center justify-center rounded-lg border border-border hover:bg-muted"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </Link>
          <h2 className="min-w-40 text-center text-lg font-semibold" aria-live="polite">
            {monthName}
          </h2>
          <Link
            href={href(shift(month, 1))}
            aria-label="Next month"
            className="inline-flex size-9 items-center justify-center rounded-lg border border-border hover:bg-muted"
          >
            <ChevronRight className="size-4" aria-hidden />
          </Link>
          <Link href="/tasks/calendar" className="ml-2 text-sm text-primary hover:underline">
            Today
          </Link>
        </div>
        <Link
          href={`/tasks/calendar?month=${month}${str(raw.show) === "all" ? "" : "&show=all"}`}
          className="text-sm text-primary hover:underline"
        >
          {str(raw.show) === "all" ? "Hide finished tasks" : "Show finished tasks"}
        </Link>
      </div>

      {/* Month grid on wide screens */}
      <div
        className="hidden overflow-hidden rounded-xl border border-border bg-card md:block"
        role="grid"
        aria-label={`Tasks due in ${monthName}`}
      >
        <div
          className="grid grid-cols-7 border-b border-border bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground"
          role="row"
        >
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-3 py-2" role="columnheader">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: lead }, (_, i) => (
            <div
              key={`pad-${i}`}
              className="min-h-28 border-b border-r border-border bg-muted/20"
              aria-hidden
            />
          ))}
          {cal.days.map((day) => {
            const tasks = cal.byDay.get(day) ?? [];
            return (
              <div
                key={day}
                role="gridcell"
                className={cn(
                  "min-h-28 border-b border-r border-border p-1.5",
                  day === todayKey && "bg-primary-soft/40",
                )}
              >
                <p
                  className={cn(
                    "mb-1 px-1 text-xs tabular-nums",
                    day === todayKey ? "font-semibold text-primary" : "text-muted-foreground",
                  )}
                >
                  {Number(day.slice(8))}
                </p>
                <ul className="flex flex-col gap-1">
                  {tasks.slice(0, 3).map((t) => (
                    <li key={t.id}>
                      <Link
                        href={`/tasks/${t.id}`}
                        title={`${t.title} · ${t.client.name}`}
                        className={cn(
                          "block truncate rounded px-1.5 py-0.5 text-xs hover:underline",
                          t.overdue ? "bg-destructive/15 text-destructive" : "bg-muted",
                        )}
                      >
                        {t.title}
                      </Link>
                    </li>
                  ))}
                  {tasks.length > 3 ? (
                    <li>
                      <details>
                        <summary className="cursor-pointer px-1 text-xs text-primary">
                          +{tasks.length - 3} more
                        </summary>
                        <ul className="mt-1 flex flex-col gap-1">
                          {tasks.slice(3).map((t) => (
                            <li key={t.id}>
                              <Link
                                href={`/tasks/${t.id}`}
                                className="block truncate rounded bg-muted px-1.5 py-0.5 text-xs hover:underline"
                              >
                                {t.title}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </li>
                  ) : null}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {/* Agenda on small screens */}
      <div className="md:hidden">
        {cal.byDay.size === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            No tasks are due in {monthName}.
          </p>
        ) : (
          <ol className="flex flex-col gap-4">
            {cal.days
              .filter((d) => cal.byDay.has(d))
              .map((day) => (
                <li key={day}>
                  <h3 className="mb-1 text-sm font-semibold">
                    {new Intl.DateTimeFormat("en-CA", {
                      weekday: "long",
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC",
                    }).format(new Date(`${day}T12:00:00Z`))}
                  </h3>
                  <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                    {cal.byDay.get(day)!.map((t) => (
                      <li
                        key={t.id}
                        className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                      >
                        <Link
                          href={`/tasks/${t.id}`}
                          className="min-w-0 truncate font-medium hover:underline"
                        >
                          {t.title}
                        </Link>
                        <StatusBadge kind="task" status={t.status} />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
          </ol>
        )}
      </div>

      <p className="mt-4 text-sm text-muted-foreground">
        {cal.undated > 0 ? (
          <>
            {cal.undated} open task{cal.undated > 1 ? "s have" : " has"} no due date.{" "}
            <Link href="/tasks?sort=recent" className="text-primary hover:underline">
              See the list
            </Link>
            .
          </>
        ) : (
          "Every open task has a due date."
        )}
        {cal.truncated ? " Showing the first 500 tasks of this month." : ""}
      </p>
    </>
  );
}
