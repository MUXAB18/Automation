import { getUnscopedPrisma } from "../unsafe";

/**
 * Every number on a dashboard or in a report comes from here, and only from stored records: synced analytics
 * snapshots, ranking readings, tasks, issues, publishing records and the AI ledger. A metric without data is
 * `null` with a reason (`no_source` / `no_data` / `partial`); nothing is estimated, interpolated or defaulted to zero.
 * Development mock data is excluded unless the caller asks for it (dashboards in development only).
 */

const prisma = () => getUnscopedPrisma();
const DAY = 86_400_000;

export type Unit = "count" | "percent" | "position" | "seconds" | "usd";
export type MetricState = "ok" | "partial" | "no_data" | "no_source";
export type Metric = {
  key: string;
  label: string;
  unit: Unit;
  value: number | null;
  previous: number | null;
  changePct: number | null;
  state: MetricState;
  note?: string;
};
export type MetricFreshness = {
  key: string;
  label: string;
  client: string;
  dataThrough: string | null;
  lastSyncedAt: string | null;
  stale: boolean;
  mock: boolean;
};
export type Point = { day: string; [series: string]: number | string | null };

export type MetricsScope = {
  clientIds: string[];
  projectId?: string | null;
  /** Development mock data is shown (and labelled) only when true. */
  includeMock?: boolean;
  /** Internal figures: AI usage and cost, overdue counts. Never set for reports or the client portal. */
  internal?: boolean;
  now?: Date;
};
export type Range = { from: string; to: string };

export const ymd = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: string, n: number) =>
  ymd(new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY));
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;

/** The window of the same length that ends the day before `from`. */
export function previousRange(r: Range): Range {
  const n = daysBetween(r.from, r.to);
  return { from: addDays(r.from, -n), to: addDays(r.from, -1) };
}

const change = (value: number | null, previous: number | null) =>
  value === null || previous === null || previous === 0
    ? null
    : ((value - previous) / previous) * 100;
const metric = (m: Omit<Metric, "changePct">): Metric => ({
  ...m,
  changePct: change(m.value, m.previous),
});
const none = (
  key: string,
  label: string,
  unit: Unit,
  state: MetricState,
  note: string,
): Metric => ({ key, label, unit, value: null, previous: null, changePct: null, state, note });

type SourceRow = {
  id: string;
  client_id: string;
  client: string;
  kind: string;
  data_through: string | null;
  last_synced_at: Date | null;
  mock: boolean;
  display: string | null;
  external_id: string;
};

async function loadSources(s: MetricsScope): Promise<SourceRow[]> {
  const rows = await prisma().$queryRaw<SourceRow[]>`
    SELECT a.id, a.client_id, c.name AS client, a.kind::text AS kind, a.data_through::text AS data_through, a.last_synced_at,
           COALESCE(a.metadata->>'mock', 'false') = 'true' AS mock, a.display_name AS display, a.external_id
    FROM analytics_sources a JOIN clients c ON c.id = a.client_id
    WHERE a.client_id = ANY(${s.clientIds}::text[]) AND a.is_active
      AND (${s.projectId ?? null}::text IS NULL OR a.website_id IN (SELECT website_id FROM seo_projects WHERE project_id = ${s.projectId ?? null}::text))`;
  return rows.filter((r) => s.includeMock || !r.mock);
}

/** Latest reading per source, metric, day (and dimension): a re-sync that revised a day replaces the old value. */
async function daily(
  sourceIds: string[],
  keys: string[],
  from: string,
  to: string,
  dimension: string,
) {
  if (sourceIds.length === 0) return [];
  return prisma().$queryRaw<{ day: string; key: string; value: number }[]>`
    WITH latest AS (
      SELECT DISTINCT ON (s.analytics_source_id, d.key, s.period_start) s.period_start, d.key, s.value::float8 AS value
      FROM metric_snapshots s JOIN metric_definitions d ON d.id = s.metric_definition_id
      WHERE s.analytics_source_id = ANY(${sourceIds}::text[]) AND d.key = ANY(${keys}::text[]) AND s.dimension_key = ${dimension}
        AND s.period_start BETWEEN ${from}::date AND ${to}::date
      ORDER BY s.analytics_source_id, d.key, s.period_start, s.captured_at DESC)
    SELECT period_start::text AS day, key, sum(value)::float8 AS value FROM latest GROUP BY period_start, key ORDER BY period_start`;
}

/** Impression-weighted average position (a plain average of daily averages would overstate small days). */
async function weightedPosition(sourceIds: string[], from: string, to: string) {
  if (sourceIds.length === 0) return { value: null as number | null, days: 0 };
  const rows = await prisma().$queryRaw<{ pos: number | null; days: number }[]>`
    WITH latest AS (
      SELECT DISTINCT ON (s.analytics_source_id, d.key, s.period_start) s.analytics_source_id AS src, s.period_start, d.key, s.value::float8 AS value
      FROM metric_snapshots s JOIN metric_definitions d ON d.id = s.metric_definition_id
      WHERE s.analytics_source_id = ANY(${sourceIds}::text[]) AND d.key IN ('gsc.position', 'gsc.impressions') AND s.dimension_key = ''
        AND s.period_start BETWEEN ${from}::date AND ${to}::date
      ORDER BY s.analytics_source_id, d.key, s.period_start, s.captured_at DESC),
    pair AS (
      SELECT src, period_start, max(value) FILTER (WHERE key = 'gsc.position') AS p, max(value) FILTER (WHERE key = 'gsc.impressions') AS i
      FROM latest GROUP BY src, period_start)
    SELECT (sum(p * i) / NULLIF(sum(i), 0))::float8 AS pos, count(DISTINCT period_start)::int AS days FROM pair WHERE p IS NOT NULL AND i IS NOT NULL`;
  return { value: rows[0]?.pos ?? null, days: rows[0]?.days ?? 0 };
}

type Totals = Record<string, number>;
const total = (rows: { key: string; value: number }[]): Totals => {
  const t: Totals = {};
  for (const r of rows) t[r.key] = (t[r.key] ?? 0) + r.value;
  return t;
};
const daysWithData = (rows: { day: string }[]) => new Set(rows.map((r) => r.day)).size;

export type SearchBlock = {
  clicks: Metric;
  impressions: Metric;
  ctr: Metric;
  position: Metric;
  series: Point[];
};
export type TrafficBlock = {
  sessions: Metric;
  organicSessions: Metric;
  engagedSessions: Metric;
  engagementRate: Metric;
  keyEvents: Metric;
  series: Point[];
};

/** Builds a Metric for a sum over a window, stating honestly when the window is only partly covered. */
function summed(
  key: string,
  label: string,
  unit: Unit,
  cur: number | undefined,
  prev: number | undefined,
  curDays: number,
  windowDays: number,
  hasSource: boolean,
  what: string,
): Metric {
  if (!hasSource) return none(key, label, unit, "no_source", `No ${what} account is connected.`);
  if (cur === undefined || curDays === 0)
    return none(key, label, unit, "no_data", `No ${what} data was synced for this period.`);
  const partial = curDays < Math.ceil(windowDays * 0.7);
  return metric({
    key,
    label,
    unit,
    value: cur,
    previous: prev ?? null,
    state: partial ? "partial" : "ok",
    note: partial ? `Only ${curDays} of ${windowDays} days have data.` : undefined,
  });
}

async function searchAndTraffic(s: MetricsScope, r: Range, sources: SourceRow[]) {
  const prev = previousRange(r);
  const n = daysBetween(r.from, r.to);
  const gsc = sources.filter((x) => x.kind === "search_console").map((x) => x.id);
  const ga4 = sources.filter((x) => x.kind === "ga4").map((x) => x.id);

  const gscKeys = ["gsc.clicks", "gsc.impressions"];
  const [gCur, gPrev, posCur, posPrev] = await Promise.all([
    daily(gsc, gscKeys, r.from, r.to, ""),
    daily(gsc, gscKeys, prev.from, prev.to, ""),
    weightedPosition(gsc, r.from, r.to),
    weightedPosition(gsc, prev.from, prev.to),
  ]);
  const gc = total(gCur),
    gp = total(gPrev);
  const gDays = daysWithData(gCur);
  const hasG = gsc.length > 0;
  const clicks = summed(
    "gsc.clicks",
    "Organic clicks",
    "count",
    gc["gsc.clicks"],
    gp["gsc.clicks"],
    gDays,
    n,
    hasG,
    "Search Console",
  );
  const impressions = summed(
    "gsc.impressions",
    "Impressions",
    "count",
    gc["gsc.impressions"],
    gp["gsc.impressions"],
    gDays,
    n,
    hasG,
    "Search Console",
  );
  // CTR is derived from the two sums (never an average of daily rates), and only when both exist.
  const ctrOf = (t: Totals) =>
    t["gsc.impressions"] ? (t["gsc.clicks"]! / t["gsc.impressions"]) * 100 : null;
  const ctr: Metric =
    clicks.value === null || impressions.value === null || !gc["gsc.impressions"]
      ? none(
          "gsc.ctr",
          "Click-through rate",
          "percent",
          clicks.state === "no_source" ? "no_source" : "no_data",
          "Needs clicks and impressions.",
        )
      : metric({
          key: "gsc.ctr",
          label: "Click-through rate",
          unit: "percent",
          value: ctrOf(gc),
          previous: ctrOf(gp),
          state: clicks.state,
        });
  const position: Metric = !hasG
    ? none(
        "gsc.position",
        "Average position",
        "position",
        "no_source",
        "No Search Console account is connected.",
      )
    : posCur.value === null
      ? none(
          "gsc.position",
          "Average position",
          "position",
          "no_data",
          "No position data was synced for this period.",
        )
      : metric({
          key: "gsc.position",
          label: "Average position",
          unit: "position",
          value: posCur.value,
          previous: posPrev.value,
          state: "ok",
          note: "Weighted by impressions. A lower number is better.",
        });
  const byDay = new Map<string, Point>();
  for (const x of gCur)
    (byDay.get(x.day) ?? byDay.set(x.day, { day: x.day }).get(x.day)!)[
      x.key === "gsc.clicks" ? "clicks" : "impressions"
    ] = x.value;

  const gaKeys = ["ga4.sessions", "ga4.engaged_sessions", "ga4.key_events"];
  const [aCur, aPrev, oCur, oPrev] = await Promise.all([
    daily(ga4, gaKeys, r.from, r.to, ""),
    daily(ga4, gaKeys, prev.from, prev.to, ""),
    daily(ga4, ["ga4.sessions"], r.from, r.to, "channel=Organic Search"),
    daily(ga4, ["ga4.sessions"], prev.from, prev.to, "channel=Organic Search"),
  ]);
  const ac = total(aCur),
    ap = total(aPrev),
    oc = total(oCur),
    op = total(oPrev);
  const aDays = daysWithData(aCur);
  const hasA = ga4.length > 0;
  const sessions = summed(
    "ga4.sessions",
    "Website sessions",
    "count",
    ac["ga4.sessions"],
    ap["ga4.sessions"],
    aDays,
    n,
    hasA,
    "Google Analytics",
  );
  const organicSessions = summed(
    "ga4.organic_sessions",
    "Organic search sessions",
    "count",
    oc["ga4.sessions"],
    op["ga4.sessions"],
    daysWithData(oCur),
    n,
    hasA,
    "Google Analytics",
  );
  const engaged = summed(
    "ga4.engaged_sessions",
    "Engaged sessions",
    "count",
    ac["ga4.engaged_sessions"],
    ap["ga4.engaged_sessions"],
    aDays,
    n,
    hasA,
    "Google Analytics",
  );
  const rate = (t: Totals) =>
    t["ga4.sessions"] ? (t["ga4.engaged_sessions"]! / t["ga4.sessions"]) * 100 : null;
  const engagementRate: Metric =
    engaged.value === null || sessions.value === null
      ? none(
          "ga4.engagement_rate",
          "Engagement rate",
          "percent",
          hasA ? "no_data" : "no_source",
          "Needs sessions and engaged sessions.",
        )
      : metric({
          key: "ga4.engagement_rate",
          label: "Engagement rate",
          unit: "percent",
          value: rate(ac),
          previous: rate(ap),
          state: engaged.state,
        });
  const keyEvents = summed(
    "ga4.key_events",
    "Conversions (key events)",
    "count",
    ac["ga4.key_events"],
    ap["ga4.key_events"],
    aDays,
    n,
    hasA,
    "Google Analytics",
  );
  if (keyEvents.value === 0 && keyEvents.state === "ok")
    keyEvents.note =
      "Counts the key events configured in Google Analytics. Zero may mean none are configured.";
  const trafficDays = new Map<string, Point>();
  for (const x of aCur)
    if (x.key === "ga4.sessions") trafficDays.set(x.day, { day: x.day, sessions: x.value });
  for (const x of oCur)
    trafficDays.set(x.day, { ...(trafficDays.get(x.day) ?? { day: x.day }), organic: x.value });

  const search: SearchBlock = { clicks, impressions, ctr, position, series: [...byDay.values()] };
  const traffic: TrafficBlock = {
    sessions,
    organicSessions,
    engagedSessions: engaged,
    engagementRate,
    keyEvents,
    series: [...trafficDays.values()].sort((a, b) => a.day.localeCompare(b.day)),
  };
  return { search, traffic };
}

export type RankingMover = { term: string; from: number; to: number; client: string };
export type RankingsBlock = {
  tracked: number;
  withChange: number;
  improved: number;
  declined: number;
  unchanged: number;
  avgPositionStart: number | null;
  avgPositionEnd: number | null;
  topImproved: RankingMover[];
  topDeclined: RankingMover[];
  state: MetricState;
  note?: string;
  lastChecked: string | null;
};

async function rankings(s: MetricsScope, r: Range): Promise<RankingsBlock> {
  const rows = await prisma().$queryRaw<
    {
      term: string;
      client: string;
      first_pos: number | null;
      last_pos: number | null;
      last_day: string | null;
    }[]
  >`
    WITH k AS (
      SELECT k.id, k.term, c.name AS client FROM keywords k JOIN clients c ON c.id = k.client_id
      WHERE k.client_id = ANY(${s.clientIds}::text[]) AND k.is_active AND (${s.includeMock ?? false} OR NOT k.is_sample)
        AND (${s.projectId ?? null}::text IS NULL OR k.seo_project_id IN (SELECT id FROM seo_projects WHERE project_id = ${s.projectId ?? null}::text))),
    snap AS (
      SELECT DISTINCT ON (r.keyword_id, r.checked_on) r.keyword_id, r.checked_on, r.position::float8 AS position
      FROM keyword_rank_snapshots r JOIN k ON k.id = r.keyword_id
      WHERE r.position IS NOT NULL AND r.checked_on BETWEEN (${r.from}::date - 30) AND ${r.to}::date
      ORDER BY r.keyword_id, r.checked_on, r.captured_at DESC),
    last AS (SELECT DISTINCT ON (keyword_id) keyword_id, position, checked_on FROM snap WHERE checked_on BETWEEN ${r.from}::date AND ${r.to}::date ORDER BY keyword_id, checked_on DESC),
    base AS (
      SELECT keyword_id, position FROM (
        SELECT keyword_id, position, row_number() OVER (PARTITION BY keyword_id ORDER BY (checked_on < ${r.from}::date) DESC,
          CASE WHEN checked_on < ${r.from}::date THEN checked_on END DESC NULLS LAST, checked_on ASC) AS rn
        FROM snap) t WHERE rn = 1)
    SELECT k.term, k.client, b.position AS first_pos, l.position AS last_pos, l.checked_on::text AS last_day
    FROM k JOIN last l ON l.keyword_id = k.id LEFT JOIN base b ON b.keyword_id = k.id`;
  if (rows.length === 0) {
    const any = await prisma().keyword.count({
      where: {
        clientId: { in: s.clientIds },
        isActive: true,
        ...(s.includeMock ? {} : { isSample: false }),
      },
    });
    return {
      tracked: any,
      withChange: 0,
      improved: 0,
      declined: 0,
      unchanged: 0,
      avgPositionStart: null,
      avgPositionEnd: null,
      topImproved: [],
      topDeclined: [],
      state: any ? "no_data" : "no_source",
      note: any ? "No ranking readings were synced for this period." : "No keywords are tracked.",
      lastChecked: null,
    };
  }
  // A keyword's change is only counted when it has an earlier reading to compare with.
  const paired = rows.filter(
    (x) => x.first_pos !== null && x.last_pos !== null && x.first_pos !== x.last_pos - 0,
  );
  const comparable = rows.filter((x) => x.first_pos !== null);
  const diff = (x: (typeof rows)[number]) => x.first_pos! - x.last_pos!; // positive = moved up the results
  const improved = comparable.filter((x) => diff(x) >= 1);
  const declined = comparable.filter((x) => diff(x) <= -1);
  const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
  void paired;
  const mover = (x: (typeof rows)[number]): RankingMover => ({
    term: x.term,
    from: x.first_pos!,
    to: x.last_pos!,
    client: x.client,
  });
  return {
    tracked: rows.length,
    withChange: comparable.length,
    improved: improved.length,
    declined: declined.length,
    unchanged: comparable.length - improved.length - declined.length,
    avgPositionStart: avg(comparable.map((x) => x.first_pos!)),
    avgPositionEnd: avg(comparable.map((x) => x.last_pos!)),
    topImproved: [...improved]
      .sort((a, b) => diff(b) - diff(a))
      .slice(0, 5)
      .map(mover),
    topDeclined: [...declined]
      .sort((a, b) => diff(a) - diff(b))
      .slice(0, 5)
      .map(mover),
    state: comparable.length === 0 ? "partial" : "ok",
    note:
      comparable.length === 0
        ? "Only one reading per keyword: no change can be calculated yet."
        : undefined,
    lastChecked:
      rows
        .map((x) => x.last_day!)
        .sort()
        .at(-1) ?? null,
  };
}

export type SocialBlock = {
  published: Metric;
  byChannel: { channel: string; count: number }[];
  engagement: {
    impressions: number | null;
    reach: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    clicks: number | null;
    posts: number;
    state: MetricState;
    note: string;
  };
};

async function social(s: MetricsScope, r: Range): Promise<SocialBlock> {
  const prev = previousRange(r);
  const projectFilter = s.projectId ? { projectId: s.projectId } : {};
  const count = async (rg: Range) => {
    const start = new Date(`${rg.from}T00:00:00Z`);
    const end = new Date(Date.parse(`${rg.to}T00:00:00Z`) + DAY);
    const [direct, manual] = await Promise.all([
      prisma().publishedPost.findMany({
        where: {
          clientId: { in: s.clientIds },
          publishedAt: { gte: start, lt: end },
          contentItem: projectFilter,
        },
        select: { contentItem: { select: { channel: true } } },
      }),
      prisma().manualPublication.findMany({
        where: {
          clientId: { in: s.clientIds },
          publishedAt: { gte: start, lt: end },
          contentItem: projectFilter,
        },
        select: { contentItem: { select: { channel: true } } },
      }),
    ]);
    const by = new Map<string, number>();
    for (const x of [...direct, ...manual])
      by.set(x.contentItem.channel, (by.get(x.contentItem.channel) ?? 0) + 1);
    return { total: direct.length + manual.length, by };
  };
  const [cur, pre] = await Promise.all([count(r), count(prev)]);
  const start = new Date(`${r.from}T00:00:00Z`);
  const end = new Date(Date.parse(`${r.to}T00:00:00Z`) + DAY);
  const rows = await prisma().$queryRaw<
    {
      posts: number;
      impressions: number;
      reach: number;
      likes: number;
      comments: number;
      shares: number;
      clicks: number;
    }[]
  >`
    WITH posts AS (SELECT p.id FROM published_posts p JOIN content_items c ON c.id = p.content_item_id
      WHERE p.client_id = ANY(${s.clientIds}::text[]) AND p.published_at >= ${start} AND p.published_at < ${end} AND (${s.projectId ?? null}::text IS NULL OR c.project_id = ${s.projectId ?? null}::text)),
    latest AS (SELECT DISTINCT ON (m.published_post_id) m.* FROM post_metric_snapshots m JOIN posts ON posts.id = m.published_post_id WHERE m.captured_at < ${end} ORDER BY m.published_post_id, m.captured_at DESC)
    SELECT count(*)::int AS posts, coalesce(sum(impressions),0)::float8 AS impressions, coalesce(sum(reach),0)::float8 AS reach, coalesce(sum(likes),0)::float8 AS likes,
           coalesce(sum(comments),0)::float8 AS comments, coalesce(sum(shares),0)::float8 AS shares, coalesce(sum(clicks),0)::float8 AS clicks FROM latest`;
  const e = rows[0]!;
  const published: Metric = metric({
    key: "social.published",
    label: "Posts published",
    unit: "count",
    value: cur.total,
    previous: pre.total,
    state: "ok",
    note: "Counts posts published through a connected account and posts recorded as published by hand.",
  });
  const engagement: SocialBlock["engagement"] =
    e.posts === 0
      ? {
          impressions: null,
          reach: null,
          likes: null,
          comments: null,
          shares: null,
          clicks: null,
          posts: 0,
          state: "no_data",
          note:
            cur.total === 0
              ? "No posts were published in this period."
              : "The providers have not reported engagement for these posts. Only posts published through a connected account can have it.",
        }
      : {
          impressions: e.impressions,
          reach: e.reach,
          likes: e.likes,
          comments: e.comments,
          shares: e.shares,
          clicks: e.clicks,
          posts: e.posts,
          state: e.posts < cur.total ? "partial" : "ok",
          note: `Latest readings for ${e.posts} of ${cur.total} posts. Posts published by hand have no engagement data.`,
        };
  return {
    published,
    byChannel: [...cur.by.entries()]
      .map(([channel, count]) => ({ channel, count }))
      .sort((a, b) => b.count - a.count),
    engagement,
  };
}

export type WorkBlock = {
  completed: Metric;
  created: Metric;
  overdue: Metric;
  issuesResolved: Metric;
  issuesOpen: { critical: number; high: number; medium: number; low: number; info: number };
  issuesOpenTotal: Metric;
  completedSeries: Point[];
};

async function work(s: MetricsScope, r: Range, now: Date): Promise<WorkBlock> {
  const prev = previousRange(r);
  const dayStart = (d: string) => new Date(`${d}T00:00:00Z`);
  const dayEndEx = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + DAY);
  const pf = s.projectId ? { projectId: s.projectId } : {};
  const issueProject = s.projectId ? { seoProject: { projectId: s.projectId } } : {};
  const cnt = (rg: Range, f: "completedAt" | "createdAt") =>
    prisma().task.count({
      where: {
        clientId: { in: s.clientIds },
        archivedAt: null,
        ...pf,
        ...(f === "completedAt" ? { status: "completed" as const } : {}),
        [f]: { gte: dayStart(rg.from), lt: dayEndEx(rg.to) },
      },
    });
  const resolved = (rg: Range) =>
    prisma().seoIssue.count({
      where: {
        clientId: { in: s.clientIds },
        ...issueProject,
        status: "fixed",
        resolvedAt: { gte: dayStart(rg.from), lt: dayEndEx(rg.to) },
      },
    });
  const [c1, c0, n1, n0, i1, i0, overdue, open, series] = await Promise.all([
    cnt(r, "completedAt"),
    cnt(prev, "completedAt"),
    cnt(r, "createdAt"),
    cnt(prev, "createdAt"),
    resolved(r),
    resolved(prev),
    s.internal
      ? prisma().task.count({
          where: {
            clientId: { in: s.clientIds },
            archivedAt: null,
            ...pf,
            status: { notIn: ["completed", "cancelled", "approved"] },
            dueAt: { lt: s.now ?? now },
          },
        })
      : Promise.resolve(null),
    prisma().seoIssue.groupBy({
      by: ["severity"],
      where: {
        clientId: { in: s.clientIds },
        ...issueProject,
        status: { in: ["open", "reopened", "acknowledged", "in_progress"] },
      },
      _count: { _all: true },
    }),
    prisma().$queryRaw<
      { day: string; n: number }[]
    >`SELECT (completed_at AT TIME ZONE 'UTC')::date::text AS day, count(*)::int AS n FROM tasks
      WHERE client_id = ANY(${s.clientIds}::text[]) AND archived_at IS NULL AND status = 'completed' AND completed_at >= ${dayStart(r.from)} AND completed_at < ${dayEndEx(r.to)}
        AND (${s.projectId ?? null}::text IS NULL OR project_id = ${s.projectId ?? null}::text) GROUP BY 1 ORDER BY 1`,
  ]);
  const by = Object.fromEntries(open.map((o) => [o.severity, o._count._all])) as Record<
    string,
    number
  >;
  const issuesOpen = {
    critical: by.critical ?? 0,
    high: by.high ?? 0,
    medium: by.medium ?? 0,
    low: by.low ?? 0,
    info: by.info ?? 0,
  };
  const openTotal = Object.values(issuesOpen).reduce((a, b) => a + b, 0);
  return {
    completed: metric({
      key: "tasks.completed",
      label: "Tasks completed",
      unit: "count",
      value: c1,
      previous: c0,
      state: "ok",
    }),
    created: metric({
      key: "tasks.created",
      label: "Tasks created",
      unit: "count",
      value: n1,
      previous: n0,
      state: "ok",
    }),
    overdue:
      overdue === null
        ? none("tasks.overdue", "Overdue tasks", "count", "no_data", "Not shown here.")
        : metric({
            key: "tasks.overdue",
            label: "Overdue tasks",
            unit: "count",
            value: overdue,
            previous: null,
            state: "ok",
            note: "As of now.",
          }),
    issuesResolved: metric({
      key: "seo.issues_resolved",
      label: "SEO issues resolved",
      unit: "count",
      value: i1,
      previous: i0,
      state: "ok",
    }),
    issuesOpen,
    issuesOpenTotal: metric({
      key: "seo.issues_open",
      label: "Open SEO issues",
      unit: "count",
      value: openTotal,
      previous: null,
      state: "ok",
      note: "As of now.",
    }),
    completedSeries: series.map((x) => ({ day: x.day, completed: x.n })),
  };
}

export type IntegrationRow = {
  client: string;
  provider: string;
  name: string;
  status: string;
  lastSyncedAt: string | null;
  lastRunStatus: string | null;
  mock: boolean;
};

async function integrations(s: MetricsScope): Promise<IntegrationRow[]> {
  const rows = await prisma()
    .integrationAccount.findMany({
      where: { clientId: { in: s.clientIds }, status: { not: "disconnected" } },
      select: {
        displayName: true,
        status: true,
        lastSyncedAt: true,
        metadata: true,
        client: { select: { name: true } },
        integration: { select: { name: true } },
        syncRuns: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
      },
    })
    .catch(() => []);
  return rows
    .map((a) => ({
      client: a.client.name,
      provider: a.integration.name,
      name: a.displayName ?? a.integration.name,
      status: a.status,
      lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null,
      lastRunStatus: a.syncRuns[0]?.status ?? null,
      mock: (a.metadata as { mock?: boolean } | null)?.mock === true,
    }))
    .filter((a) => s.includeMock || !a.mock);
}

export type AiBlock = { requests: Metric; costUsd: Metric; tokens: Metric };
async function aiUsage(s: MetricsScope, r: Range): Promise<AiBlock | null> {
  if (!s.internal) return null;
  const prev = previousRange(r);
  const q = async (rg: Range) => {
    const from = new Date(`${rg.from}T00:00:00Z`),
      to = new Date(Date.parse(`${rg.to}T00:00:00Z`) + DAY);
    const [jobs, usage] = await Promise.all([
      prisma().aiJob.count({
        where: {
          clientId: { in: s.clientIds },
          createdAt: { gte: from, lt: to },
          status: { not: "cancelled" },
        },
      }),
      prisma().aiUsageRecord.aggregate({
        where: { clientId: { in: s.clientIds }, occurredAt: { gte: from, lt: to } },
        _sum: { costMicros: true, inputTokens: true, outputTokens: true },
      }),
    ]);
    return {
      jobs,
      cost: Number(usage._sum.costMicros ?? 0n) / 1e6,
      tokens: (usage._sum.inputTokens ?? 0) + (usage._sum.outputTokens ?? 0),
    };
  };
  const [a, b] = await Promise.all([q(r), q(prev)]);
  return {
    requests: metric({
      key: "ai.requests",
      label: "AI requests",
      unit: "count",
      value: a.jobs,
      previous: b.jobs,
      state: "ok",
    }),
    costUsd: metric({
      key: "ai.cost",
      label: "Estimated AI cost",
      unit: "usd",
      value: a.cost,
      previous: b.cost,
      state: "ok",
      note: "Estimate from configured prices. Models without a price count as $0.",
    }),
    tokens: metric({
      key: "ai.tokens",
      label: "AI tokens",
      unit: "count",
      value: a.tokens,
      previous: b.tokens,
      state: "ok",
    }),
  };
}

export type MetricsResult = {
  range: Range;
  previous: Range;
  generatedAt: string;
  includesMock: boolean;
  search: SearchBlock;
  traffic: TrafficBlock;
  rankings: RankingsBlock;
  social: SocialBlock;
  work: WorkBlock;
  integrations: IntegrationRow[];
  ai: AiBlock | null;
  freshness: MetricFreshness[];
};

export async function collectMetrics(scope: MetricsScope, range: Range): Promise<MetricsResult> {
  const now = scope.now ?? new Date();
  const sources = scope.clientIds.length ? await loadSources(scope) : [];
  const empty = scope.clientIds.length === 0;
  const [st, rk, so, wk, ig, ai] = await Promise.all([
    empty ? null : searchAndTraffic(scope, range, sources),
    empty ? null : rankings(scope, range),
    empty ? null : social(scope, range),
    empty ? null : work(scope, range, now),
    empty ? [] : integrations(scope),
    empty ? null : aiUsage(scope, range),
  ]);
  const freshness: MetricFreshness[] = sources.map((x) => {
    const through = x.data_through;
    return {
      key: x.id,
      label: `${x.kind === "ga4" ? "Google Analytics" : "Search Console"}: ${x.display ?? x.external_id}`,
      client: x.client,
      dataThrough: through,
      lastSyncedAt: x.last_synced_at?.toISOString() ?? null,
      stale: !through || daysBetween(through, ymd(now)) > 4,
      mock: x.mock,
    };
  });
  const z = (k: string, l: string, u: Unit) => none(k, l, u, "no_source", "No clients in scope.");
  return {
    range,
    previous: previousRange(range),
    generatedAt: now.toISOString(),
    includesMock: !!scope.includeMock && (sources.some((x) => x.mock) || ig.some((x) => x.mock)),
    search: st?.search ?? {
      clicks: z("gsc.clicks", "Organic clicks", "count"),
      impressions: z("gsc.impressions", "Impressions", "count"),
      ctr: z("gsc.ctr", "Click-through rate", "percent"),
      position: z("gsc.position", "Average position", "position"),
      series: [],
    },
    traffic: st?.traffic ?? {
      sessions: z("ga4.sessions", "Website sessions", "count"),
      organicSessions: z("ga4.organic_sessions", "Organic search sessions", "count"),
      engagedSessions: z("ga4.engaged_sessions", "Engaged sessions", "count"),
      engagementRate: z("ga4.engagement_rate", "Engagement rate", "percent"),
      keyEvents: z("ga4.key_events", "Conversions", "count"),
      series: [],
    },
    rankings: rk ?? {
      tracked: 0,
      withChange: 0,
      improved: 0,
      declined: 0,
      unchanged: 0,
      avgPositionStart: null,
      avgPositionEnd: null,
      topImproved: [],
      topDeclined: [],
      state: "no_source",
      note: "No clients in scope.",
      lastChecked: null,
    },
    social: so ?? {
      published: z("social.published", "Posts published", "count"),
      byChannel: [],
      engagement: {
        impressions: null,
        reach: null,
        likes: null,
        comments: null,
        shares: null,
        clicks: null,
        posts: 0,
        state: "no_data",
        note: "No clients in scope.",
      },
    },
    work: wk ?? {
      completed: z("tasks.completed", "Tasks completed", "count"),
      created: z("tasks.created", "Tasks created", "count"),
      overdue: z("tasks.overdue", "Overdue tasks", "count"),
      issuesResolved: z("seo.issues_resolved", "SEO issues resolved", "count"),
      issuesOpen: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      issuesOpenTotal: z("seo.issues_open", "Open SEO issues", "count"),
      completedSeries: [],
    },
    integrations: ig,
    ai,
    freshness,
  };
}
