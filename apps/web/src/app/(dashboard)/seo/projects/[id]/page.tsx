import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, BarChart3, Gauge, Layers, Target } from "lucide-react";
import { getSeoTrend } from "@automation/db";
import { LineChart } from "@/components/seo/charts";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDay } from "@/lib/format";
import { loadSeoHeader } from "@/lib/cached";
import { requireActor } from "@/lib/session";
import { NotConnected } from "./not-connected";

export const metadata = { title: "SEO project" };

const SUMMARY_LABELS: Record<string, string> = {
  visibility_percent: "Visibility (%)",
  top5: "Keywords in top 5",
  top10: "Keywords in top 10",
  top30: "Keywords in top 30",
  da: "Domain authority (Moz)",
  index_google: "Pages indexed by Google",
};

export default async function SeoProjectOverview({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const [h, trend] = await Promise.all([loadSeoHeader(actor, id), getSeoTrend(actor, id, 90)]);
  const s = h.stats;
  const hasData = s.withReading > 0 || h.latestAudit || h.backlinks;
  const base = `/seo/projects/${id}`;
  const openIssues = Object.values(h.issues).reduce<number>((a, b) => a + (b ?? 0), 0);

  return (
    <>
      {!h.provider && !hasData ? <NotConnected what="SEO data" /> : null}
      <section aria-label="Summary" className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Tracked keywords"
          value={s.keywords}
          icon={Target}
          href={`${base}/keywords`}
          helper={`${s.ranked} ranking, ${s.withReading - s.ranked} not ranking, ${s.keywords - s.withReading} without a reading`}
        />
        <StatCard
          label="Average position"
          value={s.avgPosition === null ? "—" : s.avgPosition.toFixed(1)}
          icon={Gauge}
          helper={
            s.lastReadingDay ? `Of ranking keywords, as of ${s.lastReadingDay}` : "No readings yet"
          }
        />
        <StatCard
          label="In the top 10"
          value={s.top10}
          icon={BarChart3}
          tone="success"
          helper={`${s.top3} in the top 3`}
        />
        <StatCard
          label="Open issues"
          value={openIssues}
          icon={Layers}
          tone={openIssues ? "warning" : "default"}
          href={`${base}/issues`}
          helper={
            h.latestAudit?.healthScore != null
              ? `Audit health score ${h.latestAudit.healthScore}`
              : "No audit imported"
          }
        />
      </section>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Average position (90 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <LineChart
              label="Average position of ranking keywords per day; lower is better"
              invert
              points={trend.map((p) => ({ x: p.day, y: p.avgPosition }))}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Lower is better. Days with no ranking keywords are gaps, not zeros.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Keywords in the top 10</CardTitle>
          </CardHeader>
          <CardContent>
            <LineChart
              label="Keywords ranking in the top 10 per day"
              integerAxis
              points={trend.map((p) => ({ x: p.day, y: p.top10 }))}
            />
            <p className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <ArrowUpRight className="size-3.5 text-success" aria-hidden /> {s.improved} improved
              </span>
              <span className="inline-flex items-center gap-1">
                <ArrowDownRight className="size-3.5 text-destructive" aria-hidden /> {s.declined}{" "}
                declined since the previous reading
              </span>
            </p>
          </CardContent>
        </Card>
      </div>

      {h.provider ? (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>SE Ranking summary</CardTitle>
            <span className="text-xs text-muted-foreground">
              {h.provider.engine
                ? `${h.provider.engine.regionName ?? "Engine"} (${h.provider.engine.langCode ?? "?"}) · `
                : ""}
              {h.provider.summaryAt
                ? `as reported ${formatDay(h.provider.summaryAt)}`
                : "not reported yet"}
            </span>
          </CardHeader>
          <CardContent>
            {Object.keys(h.provider.summary).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                SE Ranking has not reported a summary for this project yet. It arrives with the next
                sync.
              </p>
            ) : (
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(SUMMARY_LABELS).map(([key, label]) => (
                  <div
                    key={key}
                    className="flex justify-between gap-3 border-b border-border py-1.5"
                  >
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-medium tabular-nums">{h.provider!.summary[key] ?? "—"}</dd>
                  </div>
                ))}
              </dl>
            )}
            {!h.provider.providerActive ? (
              <p className="mt-3">
                <Badge tone="warning">SE Ranking no longer lists this project</Badge>
              </p>
            ) : null}
            <p className="mt-3 text-xs text-muted-foreground">
              Rankings stored up to{" "}
              {h.provider.rankingsThrough ? formatDay(h.provider.rankingsThrough) : "—"}.{" "}
              <Link
                href={`/integrations/${h.provider.accountId}`}
                className="text-primary underline"
              >
                Manage the integration
              </Link>
            </p>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
