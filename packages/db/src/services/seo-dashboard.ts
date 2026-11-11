import { clientIdsWith, forClients, getAccessMap, requirePermission, type Actor } from "../access";
import { NotFoundError } from "../errors";
import type { Prisma } from "../generated/client";
import { getUnscopedPrisma } from "../unsafe";
import { PAGE_SIZE, clampPage, paged } from "./paging";

/**
 * Read models for the SEO project dashboard. Everything is computed from what is stored: no value is
 * estimated, a keyword without a reading has no position, and a missing provider shows as "not connected".
 * Raw SQL is used only for per-keyword "latest reading" aggregates, and always filters by client.
 */

const prismaClient = () => getUnscopedPrisma();
const OPEN = ["open", "reopened", "in_progress", "acknowledged"] as const;

async function authorize(actor: Actor, seoProjectId: string) {
  const row = await prismaClient().seoProject.findUnique({
    where: { id: seoProjectId },
    select: { id: true, clientId: true },
  });
  if (!row) throw new NotFoundError("SEO project not found");
  const ctx = await requirePermission(actor, row.clientId, "seo.view");
  return { ctx, clientId: row.clientId, id: row.id };
}

type Reading = {
  keywordId: string;
  day: string;
  position: number | null;
  url: string | null;
  source: string;
  rn: number;
};

/** Latest (rn = 1) and previous (rn = 2) daily reading of each keyword, one row per keyword and day. */
async function latestReadings(
  clientId: string,
  seoProjectId: string,
  keywordIds?: string[],
): Promise<Reading[]> {
  const rows = keywordIds
    ? await prismaClient().$queryRaw<
        {
          keyword_id: string;
          day: string;
          position: number | null;
          url: string | null;
          source: string;
          rn: number;
        }[]
      >`
        WITH daily AS (
          SELECT DISTINCT ON (s.keyword_id, s.checked_on) s.keyword_id, s.checked_on, s.position, s.url, s.source
          FROM keyword_rank_snapshots s JOIN keywords k ON k.id = s.keyword_id AND k.client_id = s.client_id
          WHERE s.client_id = ${clientId} AND k.seo_project_id = ${seoProjectId} AND k.id = ANY(${keywordIds}::text[])
          ORDER BY s.keyword_id, s.checked_on DESC, s.captured_at DESC
        ), ranked AS (SELECT *, row_number() OVER (PARTITION BY keyword_id ORDER BY checked_on DESC)::int AS rn FROM daily)
        SELECT keyword_id, checked_on::text AS day, position::float8 AS position, url, source::text AS source, rn FROM ranked WHERE rn <= 2`
    : await prismaClient().$queryRaw<
        {
          keyword_id: string;
          day: string;
          position: number | null;
          url: string | null;
          source: string;
          rn: number;
        }[]
      >`
        WITH daily AS (
          SELECT DISTINCT ON (s.keyword_id, s.checked_on) s.keyword_id, s.checked_on, s.position, s.url, s.source
          FROM keyword_rank_snapshots s JOIN keywords k ON k.id = s.keyword_id AND k.client_id = s.client_id
          WHERE s.client_id = ${clientId} AND k.seo_project_id = ${seoProjectId} AND k.is_active
          ORDER BY s.keyword_id, s.checked_on DESC, s.captured_at DESC
        ), ranked AS (SELECT *, row_number() OVER (PARTITION BY keyword_id ORDER BY checked_on DESC)::int AS rn FROM daily)
        SELECT keyword_id, checked_on::text AS day, position::float8 AS position, url, source::text AS source, rn FROM ranked WHERE rn <= 2`;
  return rows.map((r) => ({
    keywordId: r.keyword_id,
    day: r.day,
    position: r.position,
    url: r.url,
    source: r.source,
    rn: r.rn,
  }));
}

// ---- Header: project, provider link, last sync, headline numbers --------------------------------------

export async function getSeoProjectHeader(actor: Actor, seoProjectId: string) {
  const { ctx, clientId, id } = await authorize(actor, seoProjectId);
  const [project, keywordCount, issueGroups, latestAudit, competitors, latestBacklinks, readings] =
    await Promise.all([
      ctx.db.seoProject.findFirstOrThrow({
        where: { id },
        select: {
          id: true,
          status: true,
          targetCountry: true,
          targetLanguage: true,
          project: { select: { name: true } },
          website: { select: { domain: true } },
          providerLink: {
            select: {
              id: true,
              externalId: true,
              name: true,
              siteEngineId: true,
              engines: true,
              summary: true,
              summaryAt: true,
              syncedAt: true,
              rankingsThrough: true,
              providerActive: true,
              syncEnabled: true,
              integrationAccountId: true,
              integrationAccount: {
                select: {
                  id: true,
                  status: true,
                  metadata: true,
                  lastSyncedAt: true,
                  lastErrorAt: true,
                },
              },
            },
          },
        },
      }),
      ctx.db.keyword.count({ where: { seoProjectId: id, isActive: true } }),
      ctx.db.seoIssue.groupBy({
        by: ["severity"],
        where: { seoProjectId: id, status: { in: [...OPEN] } },
        _count: { _all: true },
      }),
      ctx.db.siteAudit.findFirst({
        where: { seoProjectId: id },
        orderBy: [{ finishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        select: {
          id: true,
          status: true,
          healthScore: true,
          pagesCrawled: true,
          finishedAt: true,
          summary: true,
          externalSource: true,
        },
      }),
      ctx.db.competitor.count({ where: { seoProjectId: id, isActive: true } }),
      ctx.db.backlinkSnapshot.findFirst({
        where: { seoProjectId: id, competitorId: null },
        orderBy: [{ capturedOn: "desc" }, { capturedAt: "desc" }],
        select: {
          totalBacklinks: true,
          referringDomains: true,
          capturedOn: true,
          source: true,
          raw: true,
        },
      }),
      latestReadings(clientId, id),
    ]);

  const latest = readings.filter((r) => r.rn === 1);
  const prev = new Map(readings.filter((r) => r.rn === 2).map((r) => [r.keywordId, r]));
  const ranked = latest.filter((r) => r.position !== null);
  let improved = 0;
  let declined = 0;
  for (const r of ranked) {
    const p = prev.get(r.keywordId)?.position;
    if (p === null || p === undefined || r.position === null) continue;
    if (r.position < p) improved++;
    else if (r.position > p) declined++;
  }
  const lastReadingDay = latest.reduce<string | null>(
    (m, r) => (!m || r.day > m ? r.day : m),
    null,
  );

  const link = project.providerLink;
  const run = link
    ? await ctx.db.syncRun.findFirst({
        where: { integrationAccountId: link.integrationAccountId },
        orderBy: { createdAt: "desc" },
        select: { status: true, finishedAt: true, startedAt: true },
      })
    : null;
  const lastOk = link
    ? await ctx.db.syncRun.findFirst({
        where: {
          integrationAccountId: link.integrationAccountId,
          status: { in: ["succeeded", "partial"] },
        },
        orderBy: { finishedAt: "desc" },
        select: { finishedAt: true, status: true },
      })
    : null;

  return {
    id,
    name: project.project.name,
    domain: project.website.domain,
    targetCountry: project.targetCountry,
    targetLanguage: project.targetLanguage,
    provider: link
      ? {
          name: link.name,
          externalId: link.externalId,
          engine:
            (
              (link.engines ?? []) as {
                siteEngineId: number;
                regionName: string | null;
                langCode: string | null;
              }[]
            ).find((e) => e.siteEngineId === link.siteEngineId) ?? null,
          summary: (link.summary ?? {}) as Record<string, number | null>,
          summaryAt: link.summaryAt,
          providerActive: link.providerActive,
          syncEnabled: link.syncEnabled,
          accountId: link.integrationAccountId,
          accountStatus: link.integrationAccount.status,
          isMock: (link.integrationAccount.metadata as { mock?: boolean }).mock === true,
          rankingsThrough: link.rankingsThrough,
          lastRunStatus: run?.status ?? null,
          lastRunAt: run?.finishedAt ?? run?.startedAt ?? null,
          lastSuccessfulSyncAt: lastOk?.finishedAt ?? null,
          lastSuccessWasPartial: lastOk?.status === "partial",
        }
      : null,
    stats: {
      keywords: keywordCount,
      withReading: latest.length,
      ranked: ranked.length,
      avgPosition: ranked.length
        ? ranked.reduce((a, r) => a + (r.position as number), 0) / ranked.length
        : null,
      top3: ranked.filter((r) => (r.position as number) <= 3).length,
      top10: ranked.filter((r) => (r.position as number) <= 10).length,
      improved,
      declined,
      lastReadingDay,
    },
    issues: Object.fromEntries(issueGroups.map((g) => [g.severity, g._count._all])) as Partial<
      Record<string, number>
    >,
    latestAudit: latestAudit
      ? {
          ...latestAudit,
          healthScore: latestAudit.healthScore === null ? null : Number(latestAudit.healthScore),
          summary: (latestAudit.summary ?? {}) as Record<string, unknown>,
        }
      : null,
    competitors,
    backlinks: latestBacklinks
      ? { ...latestBacklinks, raw: (latestBacklinks.raw ?? {}) as Record<string, unknown> }
      : null,
  };
}

// ---- Keywords ------------------------------------------------------------------------------------------

export type KeywordFilters = { q?: string; page?: number };

export async function getSeoKeywords(actor: Actor, seoProjectId: string, f: KeywordFilters = {}) {
  const { ctx, clientId, id } = await authorize(actor, seoProjectId);
  const page = clampPage(f.page);
  const q = f.q?.trim();
  const where: Prisma.KeywordWhereInput = {
    seoProjectId: id,
    isActive: true,
    ...(q ? { term: { contains: q.toLowerCase(), mode: "insensitive" } } : {}),
  };
  const [rows, total] = await Promise.all([
    ctx.db.keyword.findMany({
      where,
      orderBy: { term: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, term: true, targetUrl: true, searchVolume: true, externalSource: true },
    }),
    ctx.db.keyword.count({ where }),
  ]);
  const ids = rows.map((r) => r.id);
  const readings = ids.length ? await latestReadings(clientId, id, ids) : [];
  const history = ids.length
    ? await ctx.db.keywordRankSnapshot.findMany({
        where: { keywordId: { in: ids } },
        orderBy: [{ checkedOn: "desc" }, { capturedAt: "desc" }],
        take: ids.length * 30,
        select: { keywordId: true, checkedOn: true, position: true },
      })
    : [];
  const spark = new Map<string, Map<string, number | null>>();
  for (const h of history) {
    const days = spark.get(h.keywordId) ?? new Map<string, number | null>();
    const day = h.checkedOn.toISOString().slice(0, 10);
    if (!days.has(day) && days.size < 30)
      days.set(day, h.position === null ? null : h.position.toNumber());
    spark.set(h.keywordId, days);
  }
  return paged(
    rows.map((k) => {
      const latest = readings.find((r) => r.keywordId === k.id && r.rn === 1);
      const prev = readings.find((r) => r.keywordId === k.id && r.rn === 2);
      const change =
        latest?.position != null && prev?.position != null ? prev.position - latest.position : null;
      return {
        id: k.id,
        term: k.term,
        volume: k.searchVolume,
        provider: k.externalSource,
        position: latest?.position ?? null,
        change,
        url: latest?.url ?? k.targetUrl,
        checkedOn: latest?.day ?? null,
        source: latest?.source ?? null,
        series: [...(spark.get(k.id) ?? new Map()).entries()]
          .reverse()
          .map(([day, position]) => ({ day, position })),
      };
    }),
    total,
    page,
  );
}

// ---- Ranking trend -------------------------------------------------------------------------------------

export type TrendPoint = {
  day: string;
  avgPosition: number | null;
  top10: number;
  ranked: number;
  tracked: number;
};

export async function getSeoTrend(
  actor: Actor,
  seoProjectId: string,
  days = 90,
): Promise<TrendPoint[]> {
  const { clientId, id } = await authorize(actor, seoProjectId);
  const from = new Date(Date.now() - Math.min(Math.max(days, 7), 365) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const rows = await prismaClient().$queryRaw<
    { day: string; avg_position: number | null; top10: number; ranked: number; tracked: number }[]
  >`
    WITH daily AS (
      SELECT DISTINCT ON (s.keyword_id, s.checked_on) s.keyword_id, s.checked_on, s.position
      FROM keyword_rank_snapshots s JOIN keywords k ON k.id = s.keyword_id AND k.client_id = s.client_id
      WHERE s.client_id = ${clientId} AND k.seo_project_id = ${id} AND s.checked_on >= ${from}::date
      ORDER BY s.keyword_id, s.checked_on DESC, s.captured_at DESC
    )
    SELECT checked_on::text AS day, (avg(position) FILTER (WHERE position IS NOT NULL))::float8 AS avg_position,
      (count(*) FILTER (WHERE position <= 10))::int AS top10, (count(*) FILTER (WHERE position IS NOT NULL))::int AS ranked, count(*)::int AS tracked
    FROM daily GROUP BY checked_on ORDER BY checked_on`;
  return rows.map((r) => ({
    day: r.day,
    avgPosition: r.avg_position,
    top10: r.top10,
    ranked: r.ranked,
    tracked: r.tracked,
  }));
}

// ---- Audits, issues, competitors, backlinks ------------------------------------------------------------

export async function getSeoAudits(actor: Actor, seoProjectId: string) {
  const { ctx, id } = await authorize(actor, seoProjectId);
  const audits = await ctx.db.siteAudit.findMany({
    where: { seoProjectId: id },
    orderBy: [{ finishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: 12,
    select: {
      id: true,
      status: true,
      healthScore: true,
      pagesCrawled: true,
      finishedAt: true,
      createdAt: true,
      summary: true,
      externalSource: true,
    },
  });
  return audits.map((a) => ({
    ...a,
    healthScore: a.healthScore === null ? null : Number(a.healthScore),
    summary: (a.summary ?? {}) as {
      errors?: number | null;
      warnings?: number | null;
      notices?: number | null;
    },
  }));
}

export type IssueFilters = { severity?: string; status?: string; page?: number };
const SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;
const STATUSES = ["open", "acknowledged", "in_progress", "fixed", "ignored", "reopened"] as const;

export async function getSeoIssues(actor: Actor, seoProjectId: string, f: IssueFilters = {}) {
  const { ctx, id } = await authorize(actor, seoProjectId);
  const page = clampPage(f.page);
  const where: Prisma.SeoIssueWhereInput = {
    seoProjectId: id,
    ...(SEVERITIES.includes(f.severity as never)
      ? { severity: f.severity as (typeof SEVERITIES)[number] }
      : {}),
    ...(f.status === "active" || !f.status
      ? { status: { in: [...OPEN] } }
      : STATUSES.includes(f.status as never)
        ? { status: f.status as (typeof STATUSES)[number] }
        : {}),
  };
  const [rows, total] = await Promise.all([
    ctx.db.seoIssue.findMany({
      where,
      orderBy: [{ severity: "desc" }, { lastSeenAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        ruleKey: true,
        severity: true,
        status: true,
        title: true,
        externalSource: true,
        details: true,
        firstSeenAt: true,
        lastSeenAt: true,
        resolvedAt: true,
      },
    }),
    ctx.db.seoIssue.count({ where }),
  ]);
  return paged(
    rows.map((r) => ({
      ...r,
      details: (r.details ?? {}) as {
        section?: string | null;
        pagesAffected?: number | null;
        sampleUrls?: string[];
      },
    })),
    total,
    page,
  );
}

export async function getSeoCompetitors(actor: Actor, seoProjectId: string) {
  const { ctx, id } = await authorize(actor, seoProjectId);
  const rows = await ctx.db.competitor.findMany({
    where: { seoProjectId: id, isActive: true },
    orderBy: { domain: "asc" },
    select: { id: true, domain: true, name: true, externalSource: true, providerData: true },
  });
  return rows.map((r) => ({
    ...r,
    providerData: (r.providerData ?? {}) as { domainTrust?: number | null; readAt?: string },
  }));
}

export async function getSeoBacklinks(actor: Actor, seoProjectId: string) {
  const { ctx, id } = await authorize(actor, seoProjectId);
  const rows = await ctx.db.backlinkSnapshot.findMany({
    where: { seoProjectId: id, competitorId: null },
    orderBy: [{ capturedOn: "desc" }, { capturedAt: "desc" }],
    take: 30,
    select: {
      capturedOn: true,
      source: true,
      totalBacklinks: true,
      referringDomains: true,
      raw: true,
    },
  });
  return rows
    .reverse()
    .map((r) => ({
      ...r,
      day: r.capturedOn.toISOString().slice(0, 10),
      raw: (r.raw ?? {}) as {
        nofollow?: number | null;
        dofollow?: number | null;
        anchors?: number | null;
      },
    }));
}

// ---- List ----------------------------------------------------------------------------------------------

/** SEO projects the actor may see, with the numbers a list needs. */
export async function listSeoProjects(actor: Actor, clientId?: string) {
  const map = await getAccessMap(actor);
  const allowed = clientIdsWith(map, "seo.view");
  const ids = clientId ? allowed.filter((c) => c === clientId) : allowed;
  if (ids.length === 0) return [];
  const rows = await forClients(ids).seoProject.findMany({
    where: { clientId: { in: ids }, status: { not: "archived" } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      project: { select: { name: true } },
      website: { select: { domain: true } },
      client: { select: { name: true } },
      providerLink: { select: { syncedAt: true, syncEnabled: true } },
      _count: { select: { keywords: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.project.name,
    domain: r.website.domain,
    clientName: r.client.name,
    keywords: r._count.keywords,
    providerLinked: r.providerLink?.syncEnabled ?? false,
    syncedAt: r.providerLink?.syncedAt ?? null,
  }));
}
