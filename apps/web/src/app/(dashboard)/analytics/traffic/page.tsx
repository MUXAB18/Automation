import { Eye, Gauge, Goal, MousePointerClick, Timer, UserPlus, Users } from "lucide-react";
import { getGa4Panel } from "@automation/db";
import { AnalyticsShell, loadAnalytics, type AnalyticsParams } from "@/components/analytics/shell";
import { FreshnessBar } from "@/components/analytics/freshness";
import { fmtDuration, fmtInt, fmtPct } from "@/components/analytics/format";
import { NoRows, NoSource } from "@/components/analytics/not-connected";
import { DataTable } from "@/components/data-table";
import { LineChart } from "@/components/seo/charts";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Traffic" };

export default async function TrafficPage({
  searchParams,
}: {
  searchParams: Promise<AnalyticsParams>;
}) {
  const params = await searchParams;
  const { actor, scope, clientId, range } = await loadAnalytics(params);
  const p = clientId ? await getGa4Panel(actor, clientId, range, params.ga4) : null;
  return (
    <AnalyticsShell
      path="/analytics/traffic"
      params={params}
      range={range}
      scope={scope}
      clientId={clientId}
      sources={
        p
          ? [
              {
                param: "ga4",
                label: "Property",
                options: p.options,
                selected: p.source?.id ?? null,
              },
            ]
          : undefined
      }
    >
      {!p?.source || !p.freshness ? (
        <NoSource kind="ga4" />
      ) : (
        <>
          <FreshnessBar
            name={p.source.name}
            isMock={p.source.isMock}
            freshness={p.freshness}
            kind="ga4"
          />
          {!p.kpis ? (
            <NoRows what="Google Analytics readings" />
          ) : (
            <>
              <section
                aria-label="Traffic summary"
                className="mb-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3"
              >
                <StatCard
                  highlight
                  label="Sessions"
                  value={fmtInt(p.kpis.sessions)}
                  icon={MousePointerClick}
                  helper="Visits to the site"
                />
                <StatCard
                  label="Engaged sessions"
                  value={fmtInt(p.kpis.engagedSessions)}
                  icon={Gauge}
                  tone="success"
                  pill={{ label: `${fmtPct(p.kpis.engagementRate)} engaged`, tone: "neutral" }}
                />
                <StatCard
                  label="Key events"
                  value={fmtInt(p.kpis.keyEvents)}
                  icon={Goal}
                  tone="warning"
                  helper="Formerly conversions"
                />
                <StatCard
                  label="Page views"
                  value={fmtInt(p.kpis.pageViews)}
                  icon={Eye}
                  tone="info"
                />
                <StatCard label="New users" value={fmtInt(p.kpis.newUsers)} icon={UserPlus} />
                <StatCard
                  label="Avg session duration"
                  value={fmtDuration(p.kpis.avgSessionSeconds)}
                  icon={Timer}
                  helper="Weighted by sessions"
                />
              </section>
              <div className="mb-6 grid gap-5 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Sessions per day</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <LineChart
                      label="Sessions per day"
                      integerAxis
                      points={p.series.map((s) => ({ x: s.day, y: s.sessions }))}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Users per day</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <LineChart
                      label="Users per day"
                      integerAxis
                      points={p.series.map((s) => ({
                        x: s.day,
                        y: s.users === null ? null : Math.round(s.users),
                      }))}
                    />
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Users className="size-3.5" aria-hidden /> Distinct users cannot be added
                      across days, so only the daily figure is shown.
                    </p>
                  </CardContent>
                </Card>
              </div>
              <div className="grid gap-6 2xl:grid-cols-2">
                <div>
                  <h2 className="mb-3 text-lg font-semibold">Channels</h2>
                  {p.channels.length === 0 ? (
                    <NoRows what="channel readings" />
                  ) : (
                    <DataTable
                      caption="Sessions by channel group"
                      rows={p.channels.map((c) => ({ ...c, id: c.name }))}
                      columns={[
                        {
                          key: "n",
                          header: "Channel",
                          cell: (c) => <span className="font-medium">{c.name}</span>,
                        },
                        {
                          key: "s",
                          header: "Sessions",
                          align: "right",
                          cell: (c) => fmtInt(c.sessions),
                        },
                        {
                          key: "e",
                          header: "Engaged",
                          align: "right",
                          hideOnMobile: true,
                          cell: (c) => fmtInt(c.engagedSessions),
                        },
                        {
                          key: "k",
                          header: "Key events",
                          align: "right",
                          hideOnMobile: true,
                          cell: (c) => fmtInt(c.keyEvents),
                        },
                      ]}
                    />
                  )}
                </div>
                <div>
                  <h2 className="mb-3 text-lg font-semibold">Top landing pages</h2>
                  {p.landingPages.length === 0 ? (
                    <NoRows what="landing page readings" />
                  ) : (
                    <DataTable
                      caption="Sessions by landing page"
                      rows={p.landingPages.map((c) => ({ ...c, id: c.name }))}
                      columns={[
                        {
                          key: "n",
                          header: "Page",
                          cell: (c) => (
                            <span className="block max-w-xs truncate font-medium" title={c.name}>
                              {c.name}
                            </span>
                          ),
                        },
                        {
                          key: "s",
                          header: "Sessions",
                          align: "right",
                          cell: (c) => fmtInt(c.sessions),
                        },
                        {
                          key: "e",
                          header: "Engaged",
                          align: "right",
                          hideOnMobile: true,
                          cell: (c) => fmtInt(c.engagedSessions),
                        },
                        {
                          key: "k",
                          header: "Key events",
                          align: "right",
                          hideOnMobile: true,
                          cell: (c) => fmtInt(c.keyEvents),
                        },
                      ]}
                    />
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    The top 500 landing pages per day by sessions, summed over the range.
                  </p>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </AnalyticsShell>
  );
}
