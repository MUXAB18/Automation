import Link from "next/link";
import { AlertTriangle, BarChart3, FlaskConical, Plug } from "lucide-react";
import { getDashboard } from "@automation/db";
import { AnalyticsShell, loadAnalytics, type AnalyticsParams } from "@/components/analytics/shell";
import { MetricTile } from "@/components/analytics/metric-tile";
import { TrendChart } from "@/components/charts/trend-chart";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mockAllowed } from "@/lib/integration-view";
import { orNotFound } from "@/lib/guard";

export const metadata = { title: "Dashboard" };

const day = (d: string | null) => d ?? "unknown";
const LEVEL = {
  agency: "Agency dashboard",
  client: "Client dashboard",
  project: "Project dashboard",
} as const;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<AnalyticsParams>;
}) {
  const params = await searchParams;
  const { actor, scope, clientId, range } = await loadAnalytics(params);
  const d = await orNotFound(
    getDashboard(actor, {
      clientId: scope.clientId,
      projectId: scope.clientId ? scope.projectId : undefined,
      range,
      includeMock: mockAllowed(),
    }),
  );
  const m = d.metrics;
  const stale = m.freshness.filter((f) => f.stale);
  const hasSearchSeries = m.search.series.length > 0;
  const hasTrafficSeries = m.traffic.series.length > 0;

  return (
    <AnalyticsShell
      path="/analytics/dashboard"
      params={params}
      range={range}
      scope={scope}
      clientId={clientId}
      allowAllClients
    >
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{LEVEL[d.level]}</h2>
        <Badge tone="primary">{d.scopeName}</Badge>
        <p className="text-xs text-muted-foreground">
          Every figure comes from stored records. A missing figure says so; nothing is estimated.
        </p>
      </div>
      {m.includesMock ? (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">
          <FlaskConical className="size-4 text-warning" aria-hidden /> Includes development mock
          data (made-up numbers). Reports and the client portal never include it.
        </p>
      ) : null}

      <section
        aria-label="Data freshness"
        className="mb-6 rounded-2xl border border-border bg-card p-4 text-sm shadow-card"
      >
        <p className="mb-2 font-medium">Data freshness</p>
        {m.freshness.length === 0 ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Plug className="size-4" aria-hidden /> No Google Analytics or Search Console account is
            connected for this scope, so search and traffic figures are unavailable.
          </p>
        ) : (
          <ul className="grid gap-1 sm:grid-cols-2">
            {m.freshness.map((f) => (
              <li key={f.key} className="flex items-center justify-between gap-2">
                <span className="truncate text-muted-foreground">
                  {d.level === "agency" ? `${f.client}: ` : ""}
                  {f.label}
                </span>
                <span
                  className={f.stale ? "flex items-center gap-1 text-warning" : "text-foreground"}
                >
                  {f.stale ? <AlertTriangle className="size-3.5" aria-hidden /> : null}data through{" "}
                  {day(f.dataThrough)}
                  {f.mock ? " (mock)" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        {stale.length > 0 ? (
          <p className="mt-2 text-xs text-warning">
            Some sources are more than 4 days behind. Recent days may be missing.
          </p>
        ) : null}
      </section>

      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Search and traffic
      </h3>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile m={m.search.clicks} />
        <MetricTile m={m.search.impressions} />
        <MetricTile m={m.search.ctr} />
        <MetricTile m={m.search.position} lowerIsBetter />
        <MetricTile m={m.traffic.sessions} />
        <MetricTile m={m.traffic.organicSessions} />
        <MetricTile m={m.traffic.engagementRate} />
        <MetricTile m={m.traffic.keyEvents} />
      </div>
      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Organic clicks and impressions</CardTitle>
          </CardHeader>
          <CardContent>
            {hasSearchSeries ? (
              <TrendChart
                label="Organic clicks and impressions per day"
                data={m.search.series}
                series={[
                  { key: "clicks", label: "Clicks", color: "var(--primary)" },
                  { key: "impressions", label: "Impressions", color: "var(--info)" },
                ]}
              />
            ) : (
              <EmptyState
                icon={BarChart3}
                title="No search data"
                description="Connect Search Console and sync it to see clicks and impressions."
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            {hasTrafficSeries ? (
              <TrendChart
                label="Sessions per day"
                data={m.traffic.series}
                series={[
                  { key: "sessions", label: "All sessions", color: "var(--primary)" },
                  { key: "organic", label: "Organic search", color: "var(--success)" },
                ]}
              />
            ) : (
              <EmptyState
                icon={BarChart3}
                title="No traffic data"
                description="Connect Google Analytics and sync it to see sessions."
              />
            )}
          </CardContent>
        </Card>
      </div>

      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Rankings and social
      </h3>
      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Keyword ranking changes</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {m.rankings.state === "no_source" || m.rankings.state === "no_data" ? (
              <p className="text-muted-foreground">{m.rankings.note}</p>
            ) : (
              <>
                <p>
                  {m.rankings.tracked} keywords tracked, {m.rankings.withChange} with a comparison:{" "}
                  <span className="font-medium text-success">{m.rankings.improved} up</span>,{" "}
                  <span className="font-medium text-destructive">{m.rankings.declined} down</span>,{" "}
                  {m.rankings.unchanged} unchanged.
                </p>
                {m.rankings.avgPositionStart !== null && m.rankings.avgPositionEnd !== null ? (
                  <p className="text-muted-foreground">
                    Average position {m.rankings.avgPositionStart.toFixed(1)} to{" "}
                    {m.rankings.avgPositionEnd.toFixed(1)} (lower is better). Last check{" "}
                    {day(m.rankings.lastChecked)}.
                  </p>
                ) : null}
                {m.rankings.note ? <p className="text-xs text-warning">{m.rankings.note}</p> : null}
                {[
                  ...m.rankings.topImproved.map((k) => ({ ...k, up: true })),
                  ...m.rankings.topDeclined.map((k) => ({ ...k, up: false })),
                ].map((k) => (
                  <p key={`${k.client}-${k.term}`} className="flex justify-between gap-3">
                    <span className="truncate">{k.term}</span>
                    <span className={k.up ? "text-success" : "text-destructive"}>
                      {k.from.toFixed(1)} → {k.to.toFixed(1)}
                    </span>
                  </p>
                ))}
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Social publishing</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <MetricTile m={m.social.published} />
            {m.social.byChannel.length ? (
              <p className="text-muted-foreground">
                {m.social.byChannel
                  .map((c) => `${c.count} on ${c.channel.replace("_", " ")}`)
                  .join(" · ")}
              </p>
            ) : null}
            {m.social.engagement.state === "no_data" ? (
              <p className="text-xs text-muted-foreground">
                Engagement: {m.social.engagement.note}
              </p>
            ) : (
              <p>
                Engagement (latest readings):{" "}
                {(["impressions", "reach", "likes", "comments", "shares", "clicks"] as const)
                  .map((k) => `${(m.social.engagement[k] ?? 0).toLocaleString("en-CA")} ${k}`)
                  .join(", ")}
                . <span className="text-xs text-muted-foreground">{m.social.engagement.note}</span>
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Work
      </h3>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile m={m.work.completed} />
        {d.internal ? <MetricTile m={m.work.overdue} lowerIsBetter /> : null}
        <MetricTile m={m.work.issuesResolved} />
        <MetricTile m={m.work.issuesOpenTotal} lowerIsBetter />
      </div>
      {m.work.completedSeries.length > 0 ? (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Tasks completed per day</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendChart
              kind="bar"
              height={200}
              label="Tasks completed per day"
              data={m.work.completedSeries}
              series={[{ key: "completed", label: "Completed", color: "var(--primary)" }]}
            />
          </CardContent>
        </Card>
      ) : null}

      {d.level === "agency" && d.clients.length > 0 ? (
        <>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Clients
          </h3>
          <div className="mb-8">
            <DataTable
              caption="Clients compared"
              rows={d.clients.map((c) => ({ ...c, id: c.clientId }))}
              columns={[
                {
                  key: "name",
                  header: "Client",
                  cell: (c) => <span className="font-medium">{c.name}</span>,
                },
                {
                  key: "clicks",
                  header: "Organic clicks",
                  align: "right",
                  cell: (c) =>
                    c.clicks === null ? (
                      <span className="text-muted-foreground">No data</span>
                    ) : (
                      c.clicks.toLocaleString("en-CA")
                    ),
                },
                {
                  key: "sessions",
                  header: "Sessions",
                  align: "right",
                  cell: (c) =>
                    c.sessions === null ? (
                      <span className="text-muted-foreground">No data</span>
                    ) : (
                      c.sessions.toLocaleString("en-CA")
                    ),
                },
                {
                  key: "done",
                  header: "Tasks done",
                  align: "right",
                  cell: (c) => c.tasksCompleted ?? "–",
                },
                {
                  key: "overdue",
                  header: "Overdue",
                  align: "right",
                  hideOnMobile: true,
                  cell: (c) => c.overdue ?? "–",
                },
                {
                  key: "crit",
                  header: "Critical issues",
                  align: "right",
                  hideOnMobile: true,
                  cell: (c) => c.openCritical,
                },
                {
                  key: "health",
                  header: "Data",
                  cell: (c) =>
                    c.stale || c.integrationProblems > 0 ? (
                      <Badge tone="warning">
                        {c.integrationProblems > 0
                          ? `${c.integrationProblems} connection problem${c.integrationProblems > 1 ? "s" : ""}`
                          : "stale"}
                      </Badge>
                    ) : (
                      <Badge tone="success">current</Badge>
                    ),
                },
              ]}
            />
          </div>
        </>
      ) : null}

      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Integrations{d.internal ? " and AI" : ""}
      </h3>
      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Integration health</CardTitle>
          </CardHeader>
          <CardContent>
            {m.integrations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No integrations are connected.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {m.integrations.map((i, n) => (
                  <li key={n} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {i.provider}
                        {d.level === "agency" ? ` · ${i.client}` : ""}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {i.lastSyncedAt
                          ? `last sync ${i.lastSyncedAt.slice(0, 10)}`
                          : "never synced"}
                        {i.lastRunStatus === "failed" ? " · last run failed" : ""}
                      </span>
                    </span>
                    <StatusBadge kind="integration" status={i.status} />
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs">
              <Link href="/integrations" className="text-primary underline">
                Manage integrations
              </Link>
            </p>
          </CardContent>
        </Card>
        {d.internal && m.ai ? (
          <Card>
            <CardHeader>
              <CardTitle>AI usage and cost</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <MetricTile m={m.ai.requests} />
              <MetricTile m={m.ai.tokens} />
              <MetricTile m={m.ai.costUsd} lowerIsBetter />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AnalyticsShell>
  );
}
