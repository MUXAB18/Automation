import type { Metric, ReportView } from "@automation/db";
import { MetricTile } from "@/components/analytics/metric-tile";
import { TrendChart, type ChartPoint } from "@/components/charts/trend-chart";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type C = Record<string, unknown>;
const isMetric = (x: unknown): x is Metric =>
  !!x && typeof x === "object" && "state" in x && "label" in x;
const list = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);

function Tiles({ items }: { items: unknown[] }) {
  const ms = items.filter(isMetric);
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {ms.map((m) => (
        <MetricTile
          key={m.key}
          m={m}
          lowerIsBetter={m.key === "gsc.position" || m.key === "seo.issues_open"}
        />
      ))}
    </div>
  );
}

/** Renders a stored report exactly as the PDF and email do: only what is in its sections. */
export function ReportDocument({ view }: { view: ReportView }) {
  return (
    <div className="grid gap-6">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
        <p className="text-sm text-muted-foreground">{view.clientName}</p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight">{view.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Reporting period {view.periodStart} to {view.periodEnd} ({view.timezone})
          {view.generatedAt ? ` · generated ${view.generatedAt.slice(0, 10)}` : ""}
        </p>
      </div>
      {view.sections.map((s) => {
        const c = s.content as C;
        return (
          <Card key={s.key} id={s.key}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {s.title}
                {s.aiGenerated ? <Badge tone="warning">AI-written, reviewed</Badge> : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              {s.key === "summary" ? (
                <p className="whitespace-pre-line leading-relaxed">{String(c.text ?? "")}</p>
              ) : null}
              {s.key === "seo" ? <Seo c={c} /> : null}
              {s.key === "search_traffic" ? <SearchTraffic c={c} /> : null}
              {s.key === "social" ? <Social c={c} /> : null}
              {s.key === "work" ? (
                <>
                  <Tiles items={[c.completed, c.created]} />
                  {list<string>(c.completedTasks).length ? (
                    <ul className="list-disc space-y-1 pl-5">
                      {list<string>(c.completedTasks).map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">No tasks were completed in this period.</p>
                  )}
                </>
              ) : null}
              {s.key === "issues" ? <Issues c={c} /> : null}
              {s.key === "recommendations" ? (
                list<{ title: string; reason: string }>(c.items).length === 0 ? (
                  <p className="text-muted-foreground">
                    No recommendations arise from this period&apos;s figures.
                  </p>
                ) : (
                  <ul className="grid gap-2">
                    {list<{ title: string; reason: string }>(c.items).map((r, i) => (
                      <li key={i} className="rounded-lg border border-border p-3">
                        <p className="font-medium">{r.title}</p>
                        <p className="text-muted-foreground">{r.reason}</p>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
              {s.key === "data_sources" ? (
                <>
                  <ul className="grid gap-1">
                    {list<{ label: string; dataThrough: string | null; stale: boolean }>(
                      c.sources,
                    ).map((x, i) => (
                      <li key={i} className="flex justify-between gap-3">
                        <span>{x.label}</span>
                        <span className={x.stale ? "text-warning" : ""}>
                          data through {x.dataThrough ?? "unknown"}
                          {x.stale ? " (stale)" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {list(c.sources).length === 0 ? (
                    <p className="text-muted-foreground">
                      No analytics account was connected, so this report has no Google data.
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">{String(c.note ?? "")}</p>
                </>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function Seo({ c }: { c: C }) {
  const r = c.rankings as
    | {
        tracked: number;
        withChange: number;
        improved: number;
        declined: number;
        unchanged: number;
        avgPositionStart: number | null;
        avgPositionEnd: number | null;
        topImproved: { term: string; from: number; to: number }[];
        topDeclined: { term: string; from: number; to: number }[];
        note?: string;
        state: string;
      }
    | undefined;
  return (
    <>
      {!r || r.tracked === 0 ? (
        <p className="text-muted-foreground">{r?.note ?? "No keywords are tracked."}</p>
      ) : (
        <>
          <p>
            {r.tracked} keywords tracked, {r.withChange} with a comparison:{" "}
            <b className="text-success">{r.improved} up</b>,{" "}
            <b className="text-destructive">{r.declined} down</b>, {r.unchanged} unchanged.
            {r.avgPositionStart !== null && r.avgPositionEnd !== null
              ? ` Average position ${r.avgPositionStart.toFixed(1)} to ${r.avgPositionEnd.toFixed(1)}.`
              : ""}
          </p>
          {r.note ? <p className="text-xs text-warning">{r.note}</p> : null}
          <div className="grid gap-4 md:grid-cols-2">
            {r.topImproved.length ? (
              <div>
                <p className="mb-1 font-medium">Biggest gains</p>
                {r.topImproved.map((k) => (
                  <p key={k.term} className="flex justify-between">
                    <span>{k.term}</span>
                    <span className="text-success">
                      {k.from.toFixed(1)} → {k.to.toFixed(1)}
                    </span>
                  </p>
                ))}
              </div>
            ) : null}
            {r.topDeclined.length ? (
              <div>
                <p className="mb-1 font-medium">Biggest drops</p>
                {r.topDeclined.map((k) => (
                  <p key={k.term} className="flex justify-between">
                    <span>{k.term}</span>
                    <span className="text-destructive">
                      {k.from.toFixed(1)} → {k.to.toFixed(1)}
                    </span>
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        </>
      )}
      {isMetric(c.issuesResolved) ? <Tiles items={[c.issuesResolved]} /> : null}
    </>
  );
}

function SearchTraffic({ c }: { c: C }) {
  const s = (c.search ?? {}) as C;
  const t = (c.traffic ?? {}) as C;
  const sSeries = list<ChartPoint>(s.series),
    tSeries = list<ChartPoint>(t.series);
  return (
    <>
      <Tiles
        items={[
          s.clicks,
          s.impressions,
          s.ctr,
          s.position,
          t.sessions,
          t.organicSessions,
          t.engagementRate,
          t.keyEvents,
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {sSeries.length ? (
          <TrendChart
            height={200}
            label="Clicks and impressions per day"
            data={sSeries}
            series={[
              { key: "clicks", label: "Clicks", color: "var(--primary)" },
              { key: "impressions", label: "Impressions", color: "var(--info)" },
            ]}
          />
        ) : null}
        {tSeries.length ? (
          <TrendChart
            height={200}
            label="Sessions per day"
            data={tSeries}
            series={[
              { key: "sessions", label: "Sessions", color: "var(--primary)" },
              { key: "organic", label: "Organic", color: "var(--success)" },
            ]}
          />
        ) : null}
      </div>
    </>
  );
}

function Social({ c }: { c: C }) {
  const e = c.engagement as
    | {
        impressions: number | null;
        reach: number | null;
        likes: number | null;
        comments: number | null;
        shares: number | null;
        clicks: number | null;
        state: string;
        note: string;
      }
    | undefined;
  return (
    <>
      <Tiles items={[c.published]} />
      {list<{ channel: string; count: number }>(c.byChannel).length ? (
        <p className="text-muted-foreground">
          {list<{ channel: string; count: number }>(c.byChannel)
            .map((x) => `${x.count} on ${x.channel.replace("_", " ")}`)
            .join(" · ")}
        </p>
      ) : null}
      {e ? (
        e.state === "no_data" ? (
          <p className="text-muted-foreground">Engagement: {e.note}</p>
        ) : (
          <p>
            Engagement (latest readings):{" "}
            {(["impressions", "reach", "likes", "comments", "shares", "clicks"] as const)
              .map((k) => `${(e[k] ?? 0).toLocaleString("en-CA")} ${k}`)
              .join(", ")}
            . <span className="text-xs text-muted-foreground">{e.note}</span>
          </p>
        )
      ) : null}
    </>
  );
}

function Issues({ c }: { c: C }) {
  const o = (c.open ?? {}) as Record<string, number>;
  return (
    <>
      <p>
        Open SEO issues: <b>{o.critical ?? 0}</b> critical, <b>{o.high ?? 0}</b> high,{" "}
        {o.medium ?? 0} medium, {o.low ?? 0} low.
      </p>
      {list<{ title: string; severity: string }>(c.top).length ? (
        <ul className="list-disc space-y-1 pl-5">
          {list<{ title: string; severity: string }>(c.top).map((i, n) => (
            <li key={n}>
              <span className="text-muted-foreground">[{i.severity}]</span> {i.title}
            </li>
          ))}
        </ul>
      ) : null}
      {list<{ provider: string; status: string }>(c.integrations).length ? (
        <p className="text-warning">
          Connections needing attention:{" "}
          {list<{ provider: string; status: string }>(c.integrations)
            .map((i) => `${i.provider} (${i.status.replace("_", " ")})`)
            .join(", ")}
          .
        </p>
      ) : null}
    </>
  );
}
