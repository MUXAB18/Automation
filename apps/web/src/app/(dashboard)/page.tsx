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
import { canCreateClient, getOverview } from "@automation/db";
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
    return (
      <>
        <PageHeader title="Overview" description="Your workspace at a glance." />
        <EmptyState
          icon={Users}
          title="No clients yet"
          description={
            canCreateClient(actor)
              ? "Add your first client to start planning work."
              : "You haven't been given access to any client. Ask your agency admin to add you."
          }
          action={
            canCreateClient(actor) ? { label: "Add a client", href: "/clients/new" } : undefined
          }
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

  return (
    <>
      <PageHeader
        title={`Hello, ${actor.name.split(" ")[0] || "there"}`}
        description={`Here's where things stand for ${scopeLabel}.`}
        breadcrumbs={[{ label: "Overview" }]}
      />
      <SampleBanner show={data.sample.tasks + data.sample.content > 0} />

      <section aria-label="Key numbers" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active clients"
          value={data.clients.active}
          icon={Users}
          tone="success"
          href="/clients"
          helper={data.clients.paused > 0 ? `${data.clients.paused} paused` : "None paused"}
        />
        {data.sections.tasks ? (
          <StatCard
            label="Open tasks"
            value={data.tasks.open}
            icon={ListChecks}
            href="/tasks?open=1"
            tone={data.tasks.overdue > 0 ? "warning" : "default"}
            helper={data.tasks.overdue > 0 ? `${data.tasks.overdue} overdue` : "None overdue"}
          />
        ) : null}
        {data.sections.content ? (
          <StatCard
            label="Awaiting approval"
            value={data.content.pendingApprovals}
            icon={ClipboardCheck}
            href="/content?status=in_review"
            tone={data.content.pendingApprovals > 0 ? "warning" : "default"}
            helper="Content waiting for a decision"
          />
        ) : null}
        {data.sections.content ? (
          <StatCard
            label="Scheduled, next 14 days"
            value={data.content.upcomingCount}
            icon={CalendarClock}
            href="/content"
            tone="info"
            helper="Posts and pages going out"
          />
        ) : null}
        {data.sections.seo ? (
          <StatCard
            label="Open SEO issues"
            value={data.seo.openIssues}
            icon={Search}
            href="/seo"
            tone={data.seo.critical > 0 ? "destructive" : "default"}
            helper={
              data.seo.critical > 0
                ? `${data.seo.critical} high severity`
                : "No high-severity issues"
            }
          />
        ) : null}
        {data.sections.integrations ? (
          <StatCard
            label="Integrations needing attention"
            value={data.integrations.needAttention}
            icon={Plug}
            href="/integrations"
            tone={data.integrations.needAttention > 0 ? "warning" : "default"}
            helper={
              data.integrations.failedSyncs > 0
                ? `${data.integrations.failedSyncs} failed syncs this week`
                : "No failed syncs this week"
            }
          />
        ) : null}
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
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

        {data.sections.tasks ? (
          <Card className="lg:col-span-2">
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
          <Card className={data.sections.tasks ? "" : "lg:col-span-2"}>
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
