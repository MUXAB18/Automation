import { Eye, MousePointerClick, Percent, Trophy } from "lucide-react";
import { getGscPanel } from "@automation/db";
import { AnalyticsShell, loadAnalytics, type AnalyticsParams } from "@/components/analytics/shell";
import { FreshnessBar } from "@/components/analytics/freshness";
import { fmtInt, fmtPct, fmtPos } from "@/components/analytics/format";
import { NoRows, NoSource } from "@/components/analytics/not-connected";
import { DataTable } from "@/components/data-table";
import { LineChart } from "@/components/seo/charts";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Search performance" };

type Row = {
  name: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
};
const cols = (label: string, trunc = false) => [
  {
    key: "n",
    header: label,
    cell: (r: Row & { id: string }) => (
      <span
        className={trunc ? "block max-w-xs truncate font-medium" : "font-medium"}
        title={r.name}
      >
        {r.name}
      </span>
    ),
  },
  {
    key: "c",
    header: "Clicks",
    align: "right" as const,
    cell: (r: Row & { id: string }) => fmtInt(r.clicks),
  },
  {
    key: "i",
    header: "Impressions",
    align: "right" as const,
    hideOnMobile: true,
    cell: (r: Row & { id: string }) => fmtInt(r.impressions),
  },
  {
    key: "t",
    header: "CTR",
    align: "right" as const,
    hideOnMobile: true,
    cell: (r: Row & { id: string }) => fmtPct(r.ctr),
  },
  {
    key: "p",
    header: "Position",
    align: "right" as const,
    cell: (r: Row & { id: string }) => fmtPos(r.position),
  },
];

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<AnalyticsParams>;
}) {
  const params = await searchParams;
  const { actor, scope, clientId, range } = await loadAnalytics(params);
  const p = clientId ? await getGscPanel(actor, clientId, range, params.gsc) : null;
  const withId = (rows: Row[]) => rows.map((r) => ({ ...r, id: r.name }));
  return (
    <AnalyticsShell
      path="/analytics/search"
      params={params}
      range={range}
      scope={scope}
      clientId={clientId}
      sources={
        p
          ? [{ param: "gsc", label: "Site", options: p.options, selected: p.source?.id ?? null }]
          : undefined
      }
    >
      {!p?.source || !p.freshness ? (
        <NoSource kind="gsc" />
      ) : (
        <>
          <FreshnessBar
            name={p.source.name}
            isMock={p.source.isMock}
            freshness={p.freshness}
            kind="gsc"
          />
          {!p.kpis ? (
            <NoRows what="Search Console readings" />
          ) : (
            <>
              <section
                aria-label="Search summary"
                className="mb-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-4"
              >
                <StatCard
                  highlight
                  label="Clicks"
                  value={fmtInt(p.kpis.clicks)}
                  icon={MousePointerClick}
                  helper="From Google Search"
                />
                <StatCard
                  label="Impressions"
                  value={fmtInt(p.kpis.impressions)}
                  icon={Eye}
                  tone="info"
                />
                <StatCard
                  label="Click-through rate"
                  value={fmtPct(p.kpis.ctr)}
                  icon={Percent}
                  tone="success"
                  helper="Clicks ÷ impressions"
                />
                <StatCard
                  label="Average position"
                  value={fmtPos(p.kpis.position)}
                  icon={Trophy}
                  tone="warning"
                  helper="Lower is better"
                />
              </section>
              <div className="mb-6 grid gap-5 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Clicks per day</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <LineChart
                      label="Search clicks per day"
                      integerAxis
                      points={p.series.map((s) => ({ x: s.day, y: s.clicks }))}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Impressions per day</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <LineChart
                      label="Search impressions per day"
                      integerAxis
                      points={p.series.map((s) => ({ x: s.day, y: s.impressions }))}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Click-through rate</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <LineChart
                      label="Click-through rate per day, percent"
                      points={p.series.map((s) => ({
                        x: s.day,
                        y: s.ctr === null ? null : Math.round(s.ctr * 1000) / 10,
                      }))}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Average position</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <LineChart
                      label="Average search position per day; lower is better"
                      invert
                      points={p.series.map((s) => ({ x: s.day, y: s.position }))}
                    />
                  </CardContent>
                </Card>
              </div>
              <div className="grid gap-6 2xl:grid-cols-2">
                <div>
                  <h2 className="mb-3 text-lg font-semibold">Top queries</h2>
                  {p.queries.length === 0 ? (
                    <NoRows what="query readings" />
                  ) : (
                    <DataTable
                      caption="Top search queries"
                      rows={withId(p.queries)}
                      columns={cols("Query")}
                    />
                  )}
                </div>
                <div>
                  <h2 className="mb-3 text-lg font-semibold">Top pages</h2>
                  {p.pages.length === 0 ? (
                    <NoRows what="page readings" />
                  ) : (
                    <DataTable
                      caption="Top pages in search"
                      rows={withId(p.pages)}
                      columns={cols("Page", true)}
                    />
                  )}
                </div>
              </div>
              {p.devices.length > 0 ? (
                <div className="mt-6">
                  <h2 className="mb-3 text-lg font-semibold">Devices</h2>
                  <DataTable
                    caption="Search performance by device"
                    rows={withId(p.devices)}
                    columns={cols("Device")}
                  />
                </div>
              ) : null}
              <p className="mt-4 text-xs text-muted-foreground">
                Queries and pages are the top 500 per day that Google reports, so they will not add
                up to the totals, and anonymised queries are missing. Over a range, CTR is clicks ÷
                impressions and position is weighted by impressions. Search Console data is final
                only after two to three days.
              </p>
            </>
          )}
        </>
      )}
    </AnalyticsShell>
  );
}
