import { requirePermission, type Actor } from "../access";
import { ValidationError } from "../errors";
import { getUnscopedPrisma } from "../unsafe";
import type { SourceMeta } from "./analytics-data";

/**
 * Read models for the analytics dashboards. Everything shown comes from stored metric snapshots (the
 * latest reading per metric, day and dimension), so nothing appears before a successful sync. GA4 and
 * Search Console are returned as two separate panels: their numbers measure different things.
 */

const prismaClient = () => getUnscopedPrisma();
const MAX_DAYS = 400;
const DAY = 86_400_000;

export type DateRange = { from: string; to: string };

export function validateRange(range: DateRange): DateRange {
  const ok = /^\d{4}-\d{2}-\d{2}$/;
  if (
    !ok.test(range.from) ||
    !ok.test(range.to) ||
    Number.isNaN(Date.parse(range.from)) ||
    Number.isNaN(Date.parse(range.to))
  )
    throw new ValidationError({ range: ["Use dates like 2026-04-01"] });
  const days = (Date.parse(range.to) - Date.parse(range.from)) / DAY + 1;
  if (days < 1)
    throw new ValidationError({ range: ["The end date must not be before the start date"] });
  if (days > MAX_DAYS) throw new ValidationError({ range: [`Choose at most ${MAX_DAYS} days`] });
  return range;
}

export type Freshness = {
  hasData: boolean;
  lastSyncedAt: Date | null;
  dataThrough: string | null;
  /** Whole days between today (UTC) and the newest stored day. */
  lagDays: number | null;
  lastRun: { status: string; at: Date | null } | null;
  problem: { code: string; message: string } | null;
};

export type SourceOption = { id: string; name: string; isMock: boolean };

async function loadSources(
  ctx: Awaited<ReturnType<typeof requirePermission>>,
  clientId: string,
  kind: "ga4" | "search_console",
  wanted?: string,
) {
  const rows = await ctx.db.analyticsSource.findMany({
    where: { clientId, kind, isActive: true },
    orderBy: { displayName: "asc" },
    select: {
      id: true,
      externalId: true,
      displayName: true,
      integrationAccountId: true,
      lastSyncedAt: true,
      dataThrough: true,
      metadata: true,
    },
  });
  const selected = rows.find((r) => r.id === wanted) ?? rows[0] ?? null;
  return {
    options: rows.map<SourceOption>((r) => ({
      id: r.id,
      name: r.displayName ?? r.externalId,
      isMock: (r.metadata as SourceMeta).mock === true,
    })),
    selected,
  };
}

async function freshnessOf(
  ctx: Awaited<ReturnType<typeof requirePermission>>,
  s: NonNullable<Awaited<ReturnType<typeof loadSources>>["selected"]>,
): Promise<Freshness> {
  const run = await ctx.db.syncRun.findFirst({
    where: { integrationAccountId: s.integrationAccountId },
    orderBy: { createdAt: "desc" },
    select: { status: true, finishedAt: true, startedAt: true },
  });
  const dataThrough = s.dataThrough ? s.dataThrough.toISOString().slice(0, 10) : null;
  const problem = (s.metadata as SourceMeta).problem;
  return {
    hasData: dataThrough !== null,
    lastSyncedAt: s.lastSyncedAt,
    dataThrough,
    lagDays: dataThrough ? Math.floor((Date.now() - Date.parse(dataThrough)) / DAY) : null,
    lastRun: run ? { status: run.status, at: run.finishedAt ?? run.startedAt } : null,
    problem: problem ? { code: problem.code, message: problem.message } : null,
  };
}

type Daily = Map<string, Record<string, number>>;

/** The latest reading of each metric per day for daily totals (no dimensions). */
async function dailyTotals(
  clientId: string,
  sourceId: string,
  range: DateRange,
  keys: string[],
): Promise<Daily> {
  const rows = await prismaClient().$queryRaw<{ day: string; key: string; value: number }[]>`
    SELECT DISTINCT ON (s.metric_definition_id, s.period_start) s.period_start::text AS day, d.key, s.value::float8 AS value
    FROM metric_snapshots s JOIN metric_definitions d ON d.id = s.metric_definition_id
    WHERE s.client_id = ${clientId} AND s.analytics_source_id = ${sourceId}
      AND s.dimension_key = '' AND d.key = ANY(${keys}::text[])
      AND s.period_start BETWEEN ${range.from}::date AND ${range.to}::date
    ORDER BY s.metric_definition_id, s.period_start, s.captured_at DESC`;
  const out: Daily = new Map();
  for (const r of rows) out.set(r.day, { ...(out.get(r.day) ?? {}), [r.key]: r.value });
  return out;
}

const sum = (daily: Daily, key: string) =>
  [...daily.values()].reduce((n, d) => n + (d[key] ?? 0), 0);

// ---- Google Analytics 4 ------------------------------------------------------------------------------------

export type Ga4Row = { name: string; sessions: number; engagedSessions: number; keyEvents: number };

async function ga4Breakdown(
  clientId: string,
  sourceId: string,
  range: DateRange,
  prefix: string,
  limit: number,
): Promise<Ga4Row[]> {
  const rows = await prismaClient().$queryRaw<
    { dimension_key: string; sessions: number; engaged: number; key_events: number }[]
  >`
    WITH latest AS (
      SELECT DISTINCT ON (s.metric_definition_id, s.period_start, s.dimension_key) d.key, s.dimension_key, s.value::float8 AS value
      FROM metric_snapshots s JOIN metric_definitions d ON d.id = s.metric_definition_id
      WHERE s.client_id = ${clientId} AND s.analytics_source_id = ${sourceId}
        AND s.dimension_key LIKE ${prefix + "%"} AND d.key IN ('ga4.sessions', 'ga4.engaged_sessions', 'ga4.key_events')
        AND s.period_start BETWEEN ${range.from}::date AND ${range.to}::date
      ORDER BY s.metric_definition_id, s.period_start, s.dimension_key, s.captured_at DESC)
    SELECT dimension_key, coalesce(sum(value) FILTER (WHERE key = 'ga4.sessions'), 0)::float8 AS sessions,
      coalesce(sum(value) FILTER (WHERE key = 'ga4.engaged_sessions'), 0)::float8 AS engaged,
      coalesce(sum(value) FILTER (WHERE key = 'ga4.key_events'), 0)::float8 AS key_events
    FROM latest GROUP BY dimension_key ORDER BY sessions DESC LIMIT ${limit}`;
  return rows.map((r) => ({
    name: r.dimension_key.slice(prefix.length),
    sessions: r.sessions,
    engagedSessions: r.engaged,
    keyEvents: r.key_events,
  }));
}

export async function getGa4Panel(
  actor: Actor,
  clientId: string,
  range: DateRange,
  sourceId?: string,
) {
  validateRange(range);
  const ctx = await requirePermission(actor, clientId, "analytics.view");
  const { options, selected } = await loadSources(ctx, clientId, "ga4", sourceId);
  if (!selected)
    return {
      options,
      source: null,
      freshness: null,
      kpis: null,
      series: [],
      channels: [],
      landingPages: [],
    };
  const freshness = await freshnessOf(ctx, selected);
  const keys = [
    "ga4.sessions",
    "ga4.total_users",
    "ga4.new_users",
    "ga4.engaged_sessions",
    "ga4.avg_session_duration",
    "ga4.page_views",
    "ga4.key_events",
  ];
  const [daily, channels, landingPages] = await Promise.all([
    dailyTotals(clientId, selected.id, range, keys),
    ga4Breakdown(clientId, selected.id, range, "channel=", 12),
    ga4Breakdown(clientId, selected.id, range, "page=", 25),
  ]);
  const sessions = sum(daily, "ga4.sessions");
  const engaged = sum(daily, "ga4.engaged_sessions");
  // Duration is an average per session: weight each day by its sessions.
  const durationWeighted = [...daily.values()].reduce(
    (n, d) => n + (d["ga4.avg_session_duration"] ?? 0) * (d["ga4.sessions"] ?? 0),
    0,
  );
  return {
    options,
    source: {
      id: selected.id,
      name: selected.displayName ?? selected.externalId,
      isMock: (selected.metadata as SourceMeta).mock === true,
    },
    freshness,
    kpis:
      daily.size === 0
        ? null
        : {
            sessions,
            engagedSessions: engaged,
            newUsers: sum(daily, "ga4.new_users"),
            pageViews: sum(daily, "ga4.page_views"),
            keyEvents: sum(daily, "ga4.key_events"),
            engagementRate: sessions > 0 ? engaged / sessions : null,
            avgSessionSeconds: sessions > 0 ? durationWeighted / sessions : null,
          },
    series: [...daily.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, d]) => ({
        day,
        sessions: d["ga4.sessions"] ?? null,
        users: d["ga4.total_users"] ?? null,
        engagedSessions: d["ga4.engaged_sessions"] ?? null,
        keyEvents: d["ga4.key_events"] ?? null,
      })),
    channels,
    landingPages,
  };
}

// ---- Search Console -----------------------------------------------------------------------------------------

export type GscRow = {
  name: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
};

async function gscBreakdown(
  clientId: string,
  sourceId: string,
  range: DateRange,
  prefix: string,
  limit: number,
): Promise<GscRow[]> {
  const rows = await prismaClient().$queryRaw<
    { dimension_key: string; clicks: number; impressions: number; position: number | null }[]
  >`
    WITH latest AS (
      SELECT DISTINCT ON (s.metric_definition_id, s.period_start, s.dimension_key) d.key, s.period_start, s.dimension_key, s.value::float8 AS value
      FROM metric_snapshots s JOIN metric_definitions d ON d.id = s.metric_definition_id
      WHERE s.client_id = ${clientId} AND s.analytics_source_id = ${sourceId}
        AND s.dimension_key LIKE ${prefix + "%"} AND d.key IN ('gsc.clicks', 'gsc.impressions', 'gsc.position')
        AND s.period_start BETWEEN ${range.from}::date AND ${range.to}::date
      ORDER BY s.metric_definition_id, s.period_start, s.dimension_key, s.captured_at DESC),
    pivot AS (
      SELECT period_start, dimension_key, max(value) FILTER (WHERE key = 'gsc.clicks') AS clicks,
        max(value) FILTER (WHERE key = 'gsc.impressions') AS impressions, max(value) FILTER (WHERE key = 'gsc.position') AS position
      FROM latest GROUP BY period_start, dimension_key)
    SELECT dimension_key, coalesce(sum(clicks), 0)::float8 AS clicks, coalesce(sum(impressions), 0)::float8 AS impressions,
      (sum(position * impressions) / nullif(sum(impressions), 0))::float8 AS position
    FROM pivot GROUP BY dimension_key ORDER BY clicks DESC, impressions DESC LIMIT ${limit}`;
  return rows.map((r) => ({
    name: r.dimension_key.slice(prefix.length),
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.impressions > 0 ? r.clicks / r.impressions : null,
    position: r.position,
  }));
}

export async function getGscPanel(
  actor: Actor,
  clientId: string,
  range: DateRange,
  sourceId?: string,
) {
  validateRange(range);
  const ctx = await requirePermission(actor, clientId, "analytics.view");
  const { options, selected } = await loadSources(ctx, clientId, "search_console", sourceId);
  if (!selected)
    return {
      options,
      source: null,
      freshness: null,
      kpis: null,
      series: [],
      queries: [],
      pages: [],
      devices: [],
    };
  const freshness = await freshnessOf(ctx, selected);
  const [daily, queries, pages, devices] = await Promise.all([
    dailyTotals(clientId, selected.id, range, [
      "gsc.clicks",
      "gsc.impressions",
      "gsc.ctr",
      "gsc.position",
    ]),
    gscBreakdown(clientId, selected.id, range, "query=", 25),
    gscBreakdown(clientId, selected.id, range, "page=", 25),
    gscBreakdown(clientId, selected.id, range, "device=", 5),
  ]);
  const clicks = sum(daily, "gsc.clicks");
  const impressions = sum(daily, "gsc.impressions");
  // Average position over the range: weight each day's position by its impressions.
  const posWeighted = [...daily.values()].reduce(
    (n, d) => n + (d["gsc.position"] ?? 0) * (d["gsc.impressions"] ?? 0),
    0,
  );
  return {
    options,
    source: {
      id: selected.id,
      name: selected.displayName ?? selected.externalId,
      isMock: (selected.metadata as SourceMeta).mock === true,
    },
    freshness,
    kpis:
      daily.size === 0
        ? null
        : {
            clicks,
            impressions,
            ctr: impressions > 0 ? clicks / impressions : null,
            position: impressions > 0 ? posWeighted / impressions : null,
          },
    series: [...daily.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, d]) => ({
        day,
        clicks: d["gsc.clicks"] ?? null,
        impressions: d["gsc.impressions"] ?? null,
        ctr: d["gsc.ctr"] ?? null,
        position: d["gsc.position"] ?? null,
      })),
    queries,
    pages,
    devices,
  };
}
