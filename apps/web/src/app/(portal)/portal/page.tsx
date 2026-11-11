import Link from "next/link";
import { FileBarChart } from "lucide-react";
import {
  clientIdsWith,
  getAccessMap,
  getDashboard,
  listAwaitingClientApproval,
  listClients,
  listReportsFor,
} from "@automation/db";
import { MetricTile } from "@/components/analytics/metric-tile";
import { TrendChart } from "@/components/charts/trend-chart";
import { DataTable, formatDate } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { resolveRange } from "@/lib/analytics-range";
import { str, type RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Overview" };

export default async function PortalHome({ searchParams }: { searchParams: Promise<RawParams> }) {
  const actor = await requireActor();
  const raw = await searchParams;
  const map = await getAccessMap(actor);
  const ids = clientIdsWith(map, "report.view");
  const clients = (await listClients(actor)).filter((c) => ids.includes(c.id));
  const chosen = clients.find((c) => c.id === str(raw.client)) ?? clients[0];
  if (!chosen)
    return (
      <EmptyState
        icon={FileBarChart}
        title="Nothing to show yet"
        description="You do not have access to any client reports yet. Ask your account manager."
      />
    );

  const range = resolveRange({ range: "28d" });
  const analyticsAllowed = clientIdsWith(map, "analytics.view").includes(chosen.id);
  const [approvals, reports, dash] = await Promise.all([
    listAwaitingClientApproval(actor),
    listReportsFor(actor, { clientId: chosen.id }),
    analyticsAllowed
      ? getDashboard(actor, { clientId: chosen.id, range }).catch(() => null)
      : Promise.resolve(null),
  ]);
  const mine = approvals.filter((a) => a.clientId === chosen.id);
  const m = dash?.metrics;

  return (
    <>
      <PageHeader
        title={chosen.name}
        description="Your reports, performance and anything waiting for your approval."
      />
      {clients.length > 1 ? (
        <nav aria-label="Your businesses" className="mb-6 flex flex-wrap gap-2">
          {clients.map((c) => (
            <Link
              key={c.id}
              href={`/portal?client=${c.id}`}
              aria-current={c.id === chosen.id ? "page" : undefined}
              className={
                c.id === chosen.id
                  ? "rounded-full bg-primary px-4 py-1.5 text-sm text-primary-foreground"
                  : "rounded-full bg-card px-4 py-1.5 text-sm shadow-card"
              }
            >
              {c.name}
            </Link>
          ))}
        </nav>
      ) : null}

      {mine.length > 0 ? (
        <Card className="mb-8 border-primary/40">
          <CardHeader>
            <CardTitle>Waiting for your approval</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {mine.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                  <span>
                    <span className="font-medium">{a.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {a.channel.replace("_", " ")}
                      {a.scheduledFor
                        ? ` · planned ${a.scheduledFor.toLocaleString("en-CA", { timeZone: a.client.timezone, dateStyle: "medium", timeStyle: "short" })}`
                        : ""}
                    </span>
                  </span>
                  <Button size="sm" asChild>
                    <Link href={`/portal/approvals/${a.id}`}>Review</Link>
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Reports
      </h2>
      <div className="mb-8">
        {reports.total === 0 ? (
          <EmptyState
            icon={FileBarChart}
            title="No reports yet"
            description="Your reports appear here once they have been reviewed and approved."
          />
        ) : (
          <DataTable
            caption="Your reports"
            rows={reports.rows}
            rowHref={(r) => `/portal/reports/${r.id}`}
            columns={[
              {
                key: "title",
                header: "Report",
                cell: (r) => <span className="font-medium">{r.title}</span>,
              },
              {
                key: "period",
                header: "Period",
                hideOnMobile: true,
                cell: (r) =>
                  `${r.periodStart.toISOString().slice(0, 10)} to ${r.periodEnd.toISOString().slice(0, 10)}`,
              },
              {
                key: "status",
                header: "Status",
                cell: (r) => <StatusBadge kind="report" status={r.status} />,
              },
              {
                key: "when",
                header: "Approved",
                hideOnMobile: true,
                cell: (r) => formatDate(r.approvedAt) ?? "",
              },
              {
                key: "pdf",
                header: "",
                align: "right",
                cell: (r) => (
                  <a href={`/reports/${r.id}/pdf`} className="text-primary underline">
                    PDF
                  </a>
                ),
              },
            ]}
          />
        )}
      </div>

      {m ? (
        <>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Performance, last 28 days
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            {range.from} to {range.to}. Figures come from synced Google Analytics and Search Console
            data
            {m.freshness.length
              ? `; newest data is from ${
                  m.freshness
                    .map((f) => f.dataThrough)
                    .filter(Boolean)
                    .sort()
                    .at(-1) ?? "an unknown date"
                }`
              : ""}
            . A figure that is not available says so.
          </p>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricTile m={m.search.clicks} />
            <MetricTile m={m.search.impressions} />
            <MetricTile m={m.search.position} lowerIsBetter />
            <MetricTile m={m.traffic.sessions} />
          </div>
          {m.search.series.length > 0 || m.traffic.series.length > 0 ? (
            <div className="grid gap-6 lg:grid-cols-2">
              {m.search.series.length > 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Search clicks</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <TrendChart
                      label="Search clicks per day"
                      data={m.search.series}
                      series={[{ key: "clicks", label: "Clicks", color: "var(--primary)" }]}
                      height={200}
                    />
                  </CardContent>
                </Card>
              ) : null}
              {m.traffic.series.length > 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Website sessions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <TrendChart
                      label="Sessions per day"
                      data={m.traffic.series}
                      series={[{ key: "sessions", label: "Sessions", color: "var(--primary)" }]}
                      height={200}
                    />
                  </CardContent>
                </Card>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}
