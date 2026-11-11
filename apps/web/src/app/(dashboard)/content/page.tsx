import Link from "next/link";
import { getContentCalendar, listContentForCalendar } from "@automation/db";
import { PageHeader } from "@/components/page-header";
import { ScopeBadge } from "@/components/scope-badge";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VIEWS, isDay, rangeFor, shift, titleFor, todayUtc, type View } from "@/lib/calendar";
import { getScope } from "@/lib/scope";
import { requireSection } from "@/lib/sections";
import { oneOf, str, type RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";
import { cn } from "@/lib/utils";
import { CalendarView } from "./calendar-view";

export const metadata = { title: "Content calendar" };

export default async function ContentPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const actor = await requireActor();
  await requireSection(actor, "content");
  const raw = await searchParams;
  const scope = await getScope(actor);
  const view: View = oneOf(raw.view, VIEWS) ?? "month";
  const today = todayUtc();
  const dateParam = str(raw.date);
  const anchor = isDay(dateParam) ? dateParam : today;
  const range = rangeFor(view, anchor);
  const [{ items, unscheduled }, { canCreate }] = await Promise.all([
    getContentCalendar(actor, { clientId: scope.clientId, from: range.from, to: range.to }),
    listContentForCalendar(actor),
  ]);
  const href = (v: View, d: string) => `/content?view=${v}&date=${d}`;

  return (
    <>
      <PageHeader
        title="Content calendar"
        description="Plan, review and schedule posts. Times are shown in each client's own time zone."
        breadcrumbs={[{ label: "Content" }]}
        badges={<ScopeBadge scope={scope} />}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/content/ai">AI studio</Link>
            </Button>
            {canCreate ? (
              <Button asChild>
                <Link href={`/content/new${scope.clientId ? `?client=${scope.clientId}` : ""}`}>
                  New content
                </Link>
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={href(view, shift(view, anchor, -1))} aria-label="Previous">
              ←
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={href(view, today)}>Today</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={href(view, shift(view, anchor, 1))} aria-label="Next">
              →
            </Link>
          </Button>
          <h2 className="ml-2 text-lg font-semibold">{titleFor(view, anchor)}</h2>
        </div>
        <nav
          aria-label="Calendar view"
          className="inline-flex rounded-lg border border-border p-0.5"
        >
          {VIEWS.map((v) => (
            <Link
              key={v}
              href={href(v, anchor)}
              aria-current={v === view ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1 text-sm capitalize",
                v === view
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v}
            </Link>
          ))}
        </nav>
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_18rem]">
        <CalendarView
          view={view}
          days={range.days}
          monthOf={range.monthOf}
          today={today}
          items={items}
          multiClient={!scope.clientId}
        />
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Not scheduled yet</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {unscheduled.length === 0 ? (
              <p className="text-muted-foreground">Ideas and drafts without a date appear here.</p>
            ) : (
              unscheduled.map((u) => (
                <Link
                  key={u.id}
                  href={`/content/${u.id}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-border p-2 hover:border-primary"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{u.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {u.channel.replace("_", " ")}
                      {scope.clientId ? "" : ` · ${u.clientName}`}
                    </span>
                  </span>
                  <StatusBadge kind="content" status={u.status} />
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
