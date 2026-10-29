import Link from "next/link";
import { Plug } from "lucide-react";
import { getClientSummary } from "@automation/db";
import { formatDate } from "@/components/data-table";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SampleBadge } from "@/components/states";
import { loadClient } from "@/lib/cached";
import { orNotFound } from "@/lib/guard";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Client" };

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

export default async function ClientOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const [{ client, preferences }, summary] = await orNotFound(
    Promise.all([loadClient(actor, id), getClientSummary(actor, id)]),
  );
  const canCreateProject = summary.access.permissions.has("project.manage");

  return (
    <div className="grid gap-6">
      {summary.tasks ? (
        <section aria-label="Work" className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Active projects"
            value={summary.projects.filter((p) => p.status === "active").length}
            icon={Plug}
            href="/projects"
            helper="Open the project list"
          />
          <StatCard
            label="Open tasks"
            value={summary.tasks.open}
            icon={Plug}
            tone={summary.tasks.overdue > 0 ? "warning" : "default"}
            href="/tasks?open=1"
            helper={`${summary.tasks.dueSoon} due this week`}
          />
          <StatCard
            label="Overdue"
            value={summary.tasks.overdue}
            icon={Plug}
            tone={summary.tasks.overdue > 0 ? "destructive" : "success"}
            href="/tasks?open=1"
            helper="Past their due date"
          />
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-border">
              <Row label="Account owner">
                {client.accountOwner ? (
                  client.accountOwner.name
                ) : (
                  <span className="text-muted-foreground">Not assigned</span>
                )}
              </Row>
              <Row label="Industry">
                {client.industry ?? <span className="text-muted-foreground">—</span>}
              </Row>
              <Row label="Goals">
                {client.goals ? (
                  <p className="whitespace-pre-wrap">{client.goals}</p>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </Row>
              <Row label="Target locations">
                {client.targetLocations.length ? (
                  <span className="flex flex-wrap gap-1">
                    {client.targetLocations.map((l) => (
                      <Badge key={l} tone="outline">
                        {l}
                      </Badge>
                    ))}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </Row>
              <Row label="Time zone">
                {client.timezone.replace(/_/g, " ")} · {client.locale}
              </Row>
              <Row label="Websites">
                {client.websites.length ? (
                  client.websites
                    .map((w) => w.domain + (w.isPrimary ? " (primary)" : ""))
                    .join(", ")
                ) : (
                  <span className="text-muted-foreground">None yet</span>
                )}
              </Row>
              <Row label="Reporting">
                Every {client.reportIntervalDays} days
                {preferences.reportWeekday
                  ? `, on ${WEEKDAYS[preferences.reportWeekday - 1]}s`
                  : ""}{" "}
                · {preferences.reportDelivery === "email" ? "emailed" : "download only"}
                {client.reportEmail ? ` to ${client.reportEmail}` : ""}
                {preferences.weeklySummary ? " · plus a weekly summary" : ""}
              </Row>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Integrations</CardTitle>
          </CardHeader>
          <CardContent>
            {summary.integrations.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm">
                <p className="font-medium">Nothing connected</p>
                <p className="mt-1 text-muted-foreground">
                  Connecting Google Search Console, Analytics and social accounts is not available
                  yet. Their status and last sync will appear here.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {summary.integrations.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                  >
                    <div>
                      <p className="font-medium">{a.displayName ?? a.integration.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.integration.name} · last sync{" "}
                        {a.latestSync
                          ? `${a.latestSync.status} on ${formatDate(a.latestSync.createdAt)}`
                          : a.lastSyncedAt
                            ? formatDate(a.lastSyncedAt)
                            : "never"}
                      </p>
                    </div>
                    <StatusBadge kind="integration" status={a.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Projects</CardTitle>
            {canCreateProject ? (
              <Button asChild size="sm">
                <Link href={`/projects/new?client=${id}`}>New project</Link>
              </Button>
            ) : null}
          </CardHeader>
          <CardContent>
            {summary.projects.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No active projects yet.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {summary.projects.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                    <div className="min-w-0">
                      <Link
                        href={`/projects/${p.id}`}
                        className="flex items-center gap-2 font-medium hover:underline"
                      >
                        <span className="truncate">{p.name}</span> <SampleBadge show={p.isSample} />
                      </Link>
                      <p className="text-xs capitalize text-muted-foreground">
                        {p.kind} · {p._count.projectMemberships} people
                      </p>
                    </div>
                    <StatusBadge kind="project" status={p.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reports</CardTitle>
          </CardHeader>
          <CardContent>
            {!summary.reports ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Your role does not include reports.
              </p>
            ) : summary.reports.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No reports yet. Next one is due every {client.reportIntervalDays} days.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {summary.reports.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                    <div>
                      <p className="font-medium">{r.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(r.periodStart)} – {formatDate(r.periodEnd)}
                      </p>
                    </div>
                    <StatusBadge kind="report" status={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            {summary.activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {summary.activity.map((entry) => (
                  <li key={entry.id} className="flex items-baseline justify-between gap-3">
                    <span>
                      <code className="text-xs">{entry.action}</code>{" "}
                      <span className="text-muted-foreground">
                        by {entry.actor?.name ?? "system"}
                      </span>
                    </span>
                    <time
                      className="shrink-0 text-xs text-muted-foreground"
                      dateTime={entry.createdAt.toISOString()}
                    >
                      {entry.createdAt.toLocaleString("en-CA", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
