import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  ListChecks,
  Plug,
  Search,
  Users,
} from "lucide-react";
import { DonutChart, WeeklyBars } from "@/components/dashboard-charts";
import { canCreateClients, getOverview } from "@automation/db";
import { formatDate } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { EmptyState, SampleBadge, SampleBanner } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getScope } from "@/lib/scope";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Overview" };

const STATUS_COLOR: Record<string, string> = {
  backlog: "oklch(0.78 0.02 275)",
  assigned: "oklch(0.7 0.13 235)",
  in_progress: "oklch(0.55 0.23 272)",
  ready_for_review: "oklch(0.75 0.15 75)",
  changes_requested: "oklch(0.68 0.19 40)",
  blocked: "oklch(0.58 0.23 25)",
  approved: "oklch(0.7 0.14 170)",
  completed: "oklch(0.62 0.16 150)",
  cancelled: "oklch(0.86 0.01 275)",
};
const STATUS_ORDER = [
  "in_progress",
  "assigned",
  "ready_for_review",
  "changes_requested",
  "blocked",
  "backlog",
  "approved",
  "completed",
];
const statusLabel = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

const humanize = (action: string) => {
  const text = action.replace(/[._]/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export default async function OverviewPage() {
  const actor = await requireActor();
  const scope = await getScope(actor);
  const data = await getOverview(actor, { clientId: scope.clientId, projectId: scope.projectId });
  const clientName = scope.clients.find((c) => c.id === scope.clientId)?.name;
  const projectName = scope.projects.find((p) => p.id === scope.projectId)?.name;
  const scopeLabel = projectName
    ? `${clientName} / ${projectName}`
    : (clientName ?? "all your clients");
  const totalClients = data.clients.active + data.clients.paused + data.clients.archived;

  if (totalClients === 0) {
    const canCreate = await canCreateClients(actor);
    return (
      <>
        <PageHeader title="Overview" description="Your workspace at a glance." />
        <EmptyState
          icon={Users}
          title="No clients yet"
          description={
            canCreate
              ? "Add your first client to start planning work."
              : "You haven't been given access to any client. Ask your agency admin to add you."
          }
          action={canCreate ? { label: "Add a client", href: "/clients/new" } : undefined}
        />
      </>
    );
  }

  const attention: { key: string; text: string; href: string; tone: "warning" | "destructive" }[] =
    [];
  if (data.tasks.overdue > 0)
    attention.push({
      key: "overdue",
      text: `${data.tasks.overdue} overdue task${data.tasks.overdue > 1 ? "s" : ""}`,
      href: "/tasks?open=1",
      tone: "destructive",
    });
  if (data.content.pendingApprovals > 0)
    attention.push({
      key: "approvals",
      text: `${data.content.pendingApprovals} content item${data.content.pendingApprovals > 1 ? "s" : ""} waiting for approval`,
      href: "/content?status=in_review",
      tone: "warning",
    });
  if (data.seo.critical > 0)
    attention.push({
      key: "seo",
      text: `${data.seo.critical} high-severity SEO issue${data.seo.critical > 1 ? "s" : ""}`,
      href: "/seo",
      tone: "destructive",
    });
  if (data.integrations.needAttention > 0)
    attention.push({
      key: "accounts",
      text: `${data.integrations.needAttention} integration account${data.integrations.needAttention > 1 ? "s" : ""} need reconnecting`,
      href: "/integrations",
      tone: "warning",
    });
  if (data.integrations.failedSyncs > 0)
    attention.push({
      key: "syncs",
      text: `${data.integrations.failedSyncs} failed sync${data.integrations.failedSyncs > 1 ? "s" : ""} in the last 7 days`,
      href: "/integrations",
      tone: "destructive",
    });

  const statusCounts = new Map(data.charts.taskStatus.map((g) => [g.status, g.count]));
  const donut = STATUS_ORDER.map((key) => ({
    key,
    label: statusLabel(key),
    value: statusCounts.get(key) ?? 0,
    color: STATUS_COLOR[key]!,
  }));
  const currentWeek = data.charts.weekly[4]?.weekStart ?? "";

  return (
    <>
      <PageHeader
        title={`Hello, ${actor.name.split(" ")[0] || "there"}`}
        description={`Here's where things stand for ${scopeLabel}.`}
        breadcrumbs={[{ label: "Overview" }]}
      />
      <SampleBanner show={data.sample.tasks + data.sample.content > 0} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-5">
          <section aria-label="Key numbers" className="grid gap-5 sm:grid-cols-2">
            <StatCard
              highlight
              label="Active clients"
              value={data.clients.active}
              icon={Users}
              href="/clients"
              helper={data.clients.paused > 0 ? `${data.clients.paused} paused` : "None paused"}
            />
            {data.sections.tasks ? (
              <StatCard
                label="Open tasks"
                value={data.tasks.open}
                icon={ListChecks}
                href="/tasks?open=1"
                pill={
                  data.tasks.overdue > 0
                    ? { label: `${data.tasks.overdue} overdue`, tone: "destructive" }
                    : { label: "On track", tone: "success" }
                }
                helper={`${data.tasks.mineCount} assigned to you`}
              />
            ) : null}
            {data.sections.content ? (
              <StatCard
                label="Awaiting approval"
                value={data.content.pendingApprovals}
                icon={ClipboardCheck}
                tone="warning"
                href="/content?status=in_review"
                pill={
                  data.content.pendingApprovals > 0
                    ? { label: "Needs a decision", tone: "warning" }
                    : undefined
                }
                helper="Content waiting for a decision"
              />
            ) : null}
            {data.sections.content ? (
              <StatCard
                label="Scheduled, next 14 days"
                value={data.content.upcomingCount}
                icon={CalendarClock}
                tone="info"
                href="/content"
                helper="Posts and pages going out"
              />
            ) : null}
          </section>

          {data.sections.tasks ? (
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle>Task workload</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Tasks due each week, four weeks back and eight ahead
                  </p>
                </div>
                <Link
                  href="/tasks/calendar"
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Open calendar
                </Link>
              </CardHeader>
              <CardContent className="pt-4">
                <WeeklyBars weeks={data.charts.weekly} currentWeek={currentWeek} />
              </CardContent>
            </Card>
          ) : null}

          <section aria-label="Health" className="grid gap-5 sm:grid-cols-2">
            {data.sections.seo ? (
              <StatCard
                label="Open SEO issues"
                value={data.seo.openIssues}
                icon={Search}
                href="/seo"
                tone={data.seo.critical > 0 ? "destructive" : "default"}
                pill={
                  data.seo.critical > 0
                    ? { label: `${data.seo.critical} high severity`, tone: "destructive" }
                    : { label: "No high severity", tone: "success" }
                }
                helper="From site audits"
              />
            ) : null}
            {data.sections.integrations ? (
              <StatCard
                label="Integrations needing attention"
                value={data.integrations.needAttention}
                icon={Plug}
                href="/integrations"
                tone={data.integrations.needAttention > 0 ? "warning" : "default"}
                pill={
                  data.integrations.failedSyncs > 0
                    ? {
                        label: `${data.integrations.failedSyncs} failed syncs`,
                        tone: "destructive",
                      }
                    : { label: "All syncs healthy", tone: "success" }
                }
                helper="Accounts to reconnect"
              />
            ) : null}
          </section>
        </div>

        <div className="space-y-5">
          {data.sections.tasks ? (
            <Card>
              <CardHeader>
                <CardTitle>Tasks by status</CardTitle>
                <p className="text-xs text-muted-foreground">Everything that is not archived</p>
              </CardHeader>
              <CardContent className="pt-4">
                <DonutChart segments={donut} centerLabel="tasks" />
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Needs attention</CardTitle>
            </CardHeader>
            <CardContent>
              {attention.length === 0 ? (
                <div className="flex items-center gap-3 rounded-lg bg-success/10 px-4 py-6 text-sm">
                  <CheckCircle2 className="size-5 text-success" aria-hidden />
                  <p>
                    <span className="font-medium">Nothing needs attention.</span>{" "}
                    <span className="text-muted-foreground">
                      Overdue work, approvals and failed syncs show up here.
                    </span>
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {attention.map((a) => (
                    <li key={a.key}>
                      <Link
                        href={a.href}
                        className="flex items-center gap-3 py-3 text-sm hover:underline"
                      >
                        <AlertTriangle
                          className={
                            a.tone === "destructive"
                              ? "size-4 text-destructive"
                              : "size-4 text-warning"
                          }
                          aria-hidden
                        />
                        {a.text}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
            </CardHeader>
            <CardContent>
              {data.activity.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No activity recorded yet.
                </p>
              ) : (
                <ul className="space-y-3">
                  {data.activity.map((entry) => (
                    <li key={entry.id} className="text-sm">
                      <p className="font-medium">{humanize(entry.action)}</p>
                      <p className="text-xs text-muted-foreground">
                        {entry.entityType.replace(/_/g, " ")} · {formatDate(entry.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {data.sections.tasks ? (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>My open tasks ({data.tasks.mineCount})</CardTitle>
              <Link href="/tasks?mine=1&open=1" className="text-xs text-primary hover:underline">
                View all
              </Link>
            </CardHeader>
            <CardContent>
              {data.tasks.mine.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Nothing is assigned to you.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.tasks.mine.map((t) => (
                    <li
                      key={t.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-medium">
                          <span className="truncate">{t.title}</span>
                          <SampleBadge show={t.isSample} />
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t.client.name}
                          {t.dueAt ? ` · due ${formatDate(t.dueAt)}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {t.dueAt && t.dueAt < new Date() ? (
                          <Badge tone="destructive">overdue</Badge>
                        ) : null}
                        <StatusBadge kind="task" status={t.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}

        {data.sections.content ? (
          <Card className={data.sections.tasks ? "" : "xl:col-span-2"}>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Coming up</CardTitle>
              <Link href="/content" className="text-xs text-primary hover:underline">
                Calendar
              </Link>
            </CardHeader>
            <CardContent>
              {data.content.upcoming.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Nothing scheduled in the next 14 days.
                </p>
              ) : (
                <ul className="space-y-3">
                  {data.content.upcoming.map((c) => (
                    <li key={c.id} className="text-sm">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {c.title}
                        <SampleBadge show={c.isSample} />
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {c.client.name} · {c.channel} · {formatDate(c.scheduledFor)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
