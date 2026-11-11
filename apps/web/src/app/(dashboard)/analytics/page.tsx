import Link from "next/link";
import { Eye, Gauge, MousePointerClick, Percent, Trophy } from "lucide-react";
import { getGa4Panel, getGscPanel } from "@automation/db";
import { AnalyticsShell, loadAnalytics, type AnalyticsParams } from "@/components/analytics/shell";
import { FreshnessBar } from "@/components/analytics/freshness";
import { fmtInt, fmtPct, fmtPos } from "@/components/analytics/format";
import { NoRows, NoSource } from "@/components/analytics/not-connected";
import { LineChart } from "@/components/seo/charts";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<AnalyticsParams>;
}) {
  const params = await searchParams;
  const { actor, scope, clientId, range } = await loadAnalytics(params);
  const [ga, gsc] = clientId
    ? await Promise.all([
        getGa4Panel(actor, clientId, range, params.ga4),
        getGscPanel(actor, clientId, range, params.gsc),
      ])
    : [null, null];
  const q = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v) as [string, string][],
  ).toString();
  const suffix = q ? `?${q}` : "";
  return (
    <AnalyticsShell
      path="/analytics"
      params={params}
      range={range}
      scope={scope}
      clientId={clientId}
      sources={
        ga && gsc
          ? [
              {
                param: "ga4",
                label: "Analytics property",
                options: ga.options,
                selected: ga.source?.id ?? null,
              },
              {
                param: "gsc",
                label: "Search Console site",
                options: gsc.options,
                selected: gsc.source?.id ?? null,
              },
            ]
          : undefined
      }
    >
      <p className="mb-5 rounded-xl bg-card px-4 py-3 text-xs text-muted-foreground shadow-card">
        <strong className="text-foreground">Two different measurements.</strong> Google Analytics
        counts <em>sessions</em> on the website from every source; Search Console counts{" "}
        <em>clicks</em> from Google Search results. They will not match, and are never added
        together.
      </p>
      <div className="grid gap-6 xl:grid-cols-2">
        <section aria-label="Google Analytics 4" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Website traffic{" "}
              <span className="text-sm font-normal text-muted-foreground">
                · Google Analytics 4
              </span>
            </h2>
            <Link
              href={`/analytics/traffic${suffix}`}
              className="text-xs font-medium text-primary hover:underline"
            >
              Open traffic
            </Link>
          </div>
          {!ga?.source || !ga.freshness ? (
            <NoSource kind="ga4" />
          ) : (
            <>
              <FreshnessBar
                name={ga.source.name}
                isMock={ga.source.isMock}
                freshness={ga.freshness}
                kind="ga4"
              />
              {!ga.kpis ? (
                <NoRows what="Google Analytics readings" />
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <StatCard
                      highlight
                      label="Sessions"
                      value={fmtInt(ga.kpis.sessions)}
                      icon={MousePointerClick}
                    />
                    <StatCard
                      label="Engagement rate"
                      value={fmtPct(ga.kpis.engagementRate)}
                      icon={Gauge}
                      tone="success"
                      helper="Engaged ÷ sessions"
                    />
                  </div>
                  <Card>
                    <CardHeader>
                      <CardTitle>Sessions per day</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <LineChart
                        label="Sessions per day"
                        integerAxis
                        points={ga.series.map((s) => ({ x: s.day, y: s.sessions }))}
                      />
                    </CardContent>
                  </Card>
                </>
              )}
            </>
          )}
        </section>
        <section aria-label="Search Console" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Search performance{" "}
              <span className="text-sm font-normal text-muted-foreground">· Search Console</span>
            </h2>
            <Link
              href={`/analytics/search${suffix}`}
              className="text-xs font-medium text-primary hover:underline"
            >
              Open search
            </Link>
          </div>
          {!gsc?.source || !gsc.freshness ? (
            <NoSource kind="gsc" />
          ) : (
            <>
              <FreshnessBar
                name={gsc.source.name}
                isMock={gsc.source.isMock}
                freshness={gsc.freshness}
                kind="gsc"
              />
              {!gsc.kpis ? (
                <NoRows what="Search Console readings" />
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <StatCard
                      highlight
                      label="Clicks"
                      value={fmtInt(gsc.kpis.clicks)}
                      icon={MousePointerClick}
                    />
                    <StatCard
                      label="Impressions"
                      value={fmtInt(gsc.kpis.impressions)}
                      icon={Eye}
                      tone="info"
                    />
                    <StatCard
                      label="Click-through rate"
                      value={fmtPct(gsc.kpis.ctr)}
                      icon={Percent}
                      tone="success"
                    />
                    <StatCard
                      label="Average position"
                      value={fmtPos(gsc.kpis.position)}
                      icon={Trophy}
                      tone="warning"
                      helper="Lower is better"
                    />
                  </div>
                  <Card>
                    <CardHeader>
                      <CardTitle>Clicks per day</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <LineChart
                        label="Search clicks per day"
                        integerAxis
                        points={gsc.series.map((s) => ({ x: s.day, y: s.clicks }))}
                      />
                    </CardContent>
                  </Card>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </AnalyticsShell>
  );
}
