import type { z } from "zod";
import { ProviderError, toProviderError } from "../../framework/errors";
import { PROVIDERS } from "../../framework/providers";
import type {
  AdapterContext,
  ConnectionTestResult,
  Credentials,
  NormalizedRecord,
  Page,
  PageRequest,
  ProviderAdapter,
} from "../../framework/types";
import {
  AUDITS_PAGE,
  BACKFILL_DAYS,
  MAX_ISSUE_URL_LOOKUPS,
  OVERLAP_DAYS,
  SAMPLE_URLS_PER_ISSUE,
  WINDOW_DAYS,
  type SeRankingConfig,
  type SeRankingSettings,
} from "./config";
import { createSeRankingHttp, type SeRankingDeps } from "./http";
import * as schemas from "./schemas";

const PM = "/v1/project-management";
const AUDIT = "/v1/site-audit/audits";
const MAX_PROJECTS = 200;

type Cursor = {
  p?: number;
  from?: string;
  phase?: "list" | "report";
  offset?: number;
  best?: Record<string, { id: string; at: string }>;
  queue?: { siteId: string; auditId: string }[];
  i?: number;
};
const encode = (c: Cursor) => JSON.stringify(c);
const decode = (raw: string | null): Cursor => {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Cursor;
  } catch {
    return {};
  }
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) =>
  ymd(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000));

function parse<T extends z.ZodType>(schema: T, data: unknown, what: string): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success)
    throw new ProviderError(
      "invalid_response",
      `SE Ranking returned ${what} in an unexpected shape.`,
    );
  return result.data;
}

const settingsOf = (ctx: AdapterContext): SeRankingSettings => {
  const parsed = schemas.settingsSchema.safeParse(ctx.settings ?? { projects: [] });
  return parsed.success ? parsed.data : { projects: [] };
};

/** An item produced by fetchPage; `normalize` turns each kind into records. */
type Item = { kind: string } & Record<string, unknown>;

export function createSeRankingAdapter(
  config: SeRankingConfig = {},
  deps: SeRankingDeps & { today?: () => Date } = {},
): ProviderAdapter {
  const descriptor = PROVIDERS.find((p) => p.key === "se_ranking")!;
  const http = createSeRankingHttp(config, deps);
  const today = () => ymd(deps.today?.() ?? new Date());
  const get = (c: Credentials, path: string, query?: Record<string, string | number | undefined>) =>
    http.request(c, path, query);

  /** Run one linked project's call; a project the provider no longer has is reported, not fatal. */
  async function perProject(
    request: PageRequest,
    ctx: AdapterContext,
    run: (
      project: SeRankingSettings["projects"][number],
      cursor: Cursor,
    ) => Promise<{ items: Item[]; next?: Cursor }>,
  ): Promise<Page<unknown>> {
    const { projects } = settingsOf(ctx);
    const cursor = decode(request.cursor);
    const p = cursor.p ?? 0;
    const project = projects[p];
    if (!project) return { items: [], nextCursor: null };
    let result: { items: Item[]; next?: Cursor };
    try {
      result = await run(project, cursor);
    } catch (error) {
      const mapped = toProviderError(error);
      if (mapped.code !== "not_found") throw mapped;
      result = { items: [{ kind: "missing", siteId: project.siteId }] };
    }
    const next = result.next ?? (p + 1 < projects.length ? { p: p + 1 } : null);
    return { items: result.items, nextCursor: next ? encode(next) : null };
  }

  return {
    descriptor: { ...descriptor, live: true },
    isMock: false,
    credentialFields: descriptor.credentialFields,

    async testConnection(credentials): Promise<ConnectionTestResult> {
      try {
        const sites = parse(
          schemas.sitesResponse,
          await get(credentials, `${PM}/sites`),
          "the project list",
        );
        return {
          ok: true,
          // The API documents no account endpoint, so one SE Ranking account per client is assumed.
          externalAccountId: "seranking",
          displayName: `SE Ranking (${sites.length} project${sites.length === 1 ? "" : "s"})`,
          grantedScopes: [],
        };
      } catch (error) {
        return { ok: false, error: toProviderError(error) };
      }
    },

    async fetchPage(credentials, request, ctx): Promise<Page<unknown>> {
      switch (request.resource) {
        case "projects": {
          const sites = parse(
            schemas.sitesResponse,
            await get(credentials, `${PM}/sites`),
            "the project list",
          ).slice(0, MAX_PROJECTS);
          const items: Item[] = [];
          for (const site of sites) {
            // Engines are needed to pick the one whose rankings are tracked.
            const engines = parse(
              schemas.enginesResponse,
              await get(credentials, `${PM}/sites/search-engines`, { site_id: site.id }),
              "the search engines",
            );
            items.push({ kind: "project", site, engines });
          }
          return { items, nextCursor: null };
        }
        case "keywords":
          return perProject(request, ctx, async (project) => {
            const rows = parse(
              schemas.keywordsResponse,
              await get(credentials, `${PM}/keywords`, {
                site_id: project.siteId,
                site_engine_id: project.siteEngineId,
              }),
              "keywords",
            );
            return {
              items: rows.map((k) => ({ kind: "keyword", siteId: project.siteId, keyword: k })),
            };
          });
        case "rankings":
          return perProject(request, ctx, async (project, cursor) => {
            const end0 = today();
            const start =
              cursor.from ??
              (project.rankingsThrough
                ? addDays(project.rankingsThrough, -OVERLAP_DAYS)
                : addDays(end0, -BACKFILL_DAYS));
            const end =
              addDays(start, WINDOW_DAYS - 1) < end0 ? addDays(start, WINDOW_DAYS - 1) : end0;
            const groups = parse(
              schemas.positionsResponse,
              await get(credentials, `${PM}/sites/positions`, {
                site_id: project.siteId,
                site_engine_id: project.siteEngineId,
                date_from: start,
                date_to: end,
                with_landing_pages: 1,
              }),
              "rankings",
            );
            const items: Item[] = groups.flatMap((g) =>
              g.keywords.map((k) => ({ kind: "ranking", siteId: project.siteId, keyword: k })),
            );
            return {
              items,
              next: end < end0 ? { p: cursor.p ?? 0, from: addDays(end, 1) } : undefined,
            };
          });
        case "project_summary":
          return perProject(request, ctx, async (project) => {
            const summary = parse(
              schemas.summaryResponse,
              await get(credentials, `${PM}/sites/summary`, { site_id: project.siteId }),
              "the project summary",
            );
            return { items: [{ kind: "summary", siteId: project.siteId, summary }] };
          });
        case "competitors":
          return perProject(request, ctx, async (project) => {
            const rows = parse(
              schemas.competitorsResponse,
              await get(credentials, `${PM}/competitors`, { site_id: project.siteId }),
              "competitors",
            );
            return {
              items: rows.map((c) => ({
                kind: "competitor",
                siteId: project.siteId,
                competitor: c,
              })),
            };
          });
        case "backlinks":
          return perProject(request, ctx, async (project) => {
            const stats = parse(
              schemas.backlinkStatsResponse,
              await get(credentials, `${PM}/backlinks/stats`, { site_id: project.siteId }),
              "backlink statistics",
            );
            return { items: [{ kind: "backlinks", siteId: project.siteId, stats }] };
          });
        case "audits":
          return auditsPage(credentials, request, ctx);
        default:
          throw new ProviderError(
            "invalid_request",
            `SE Ranking has no resource named ${request.resource}.`,
          );
      }
    },

    normalize(resource, items): NormalizedRecord[] {
      const rec = (
        r: string,
        externalId: string,
        data: Record<string, unknown>,
        occurredAt: string | null = null,
      ): NormalizedRecord => ({
        resource: r,
        externalId,
        occurredAt,
        data,
        source: "live",
      });
      const out: NormalizedRecord[] = [];
      for (const raw of items as Item[]) {
        switch (raw.kind) {
          case "project": {
            const { site, engines } = raw as unknown as {
              site: z.infer<typeof schemas.sitesResponse>[number];
              engines: z.infer<typeof schemas.enginesResponse>;
            };
            out.push(
              rec("projects", site.id, {
                name: site.name ?? null,
                title: site.title ?? null,
                providerActive:
                  site.is_active === undefined || site.is_active === null
                    ? true
                    : Boolean(site.is_active),
                keywordCount: site.keyword_count,
                engines: engines
                  .filter((e) => e.site_engine_id !== null)
                  .map((e) => ({
                    siteEngineId: e.site_engine_id,
                    searchEngineId: e.search_engine_id,
                    regionId: e.region_id,
                    regionName: e.region_name ?? null,
                    langCode: e.lang_code ?? null,
                  })),
              }),
            );
            break;
          }
          case "missing":
            out.push(rec("project_missing", String(raw.siteId), { siteId: raw.siteId }));
            break;
          case "keyword": {
            const { siteId, keyword: k } = raw as unknown as {
              siteId: string;
              keyword: z.infer<typeof schemas.keywordsResponse>[number];
            };
            out.push(
              rec("keywords", `${siteId}:${k.id}`, {
                siteId,
                keywordExternalId: k.id,
                term: k.name,
                targetUrl: k.link ?? null,
                tags: k.tags ?? [],
              }),
            );
            break;
          }
          case "ranking": {
            const { siteId, keyword: k } = raw as unknown as {
              siteId: string;
              keyword: z.infer<typeof schemas.positionsResponse>[number]["keywords"][number];
            };
            // Landing pages are listed per date; the nearest one at or before the check is the page that ranked.
            const pages = [...(k.landing_pages ?? [])].sort((a, b) =>
              (a.date ?? "").localeCompare(b.date ?? ""),
            );
            for (const pos of k.positions ?? []) {
              const day = pos.date.slice(0, 10);
              const page =
                [...pages].reverse().find((l) => !l.date || l.date.slice(0, 10) <= day) ?? null;
              out.push(
                rec(
                  "rankings",
                  `${siteId}:${k.id}:${day}`,
                  {
                    siteId,
                    keywordExternalId: k.id,
                    date: day,
                    // A position of zero or none means the keyword was not found in the tracked range, not "position 0".
                    position: pos.pos !== null && pos.pos > 0 ? pos.pos : null,
                    url: page?.url ?? null,
                    volume: k.volume,
                  },
                  `${day}T00:00:00.000Z`,
                ),
              );
            }
            break;
          }
          case "summary": {
            const { siteId, summary } = raw as unknown as {
              siteId: string;
              summary: Record<string, number | null>;
            };
            out.push(rec("project_summary", siteId, { siteId, summary }));
            break;
          }
          case "competitor": {
            const { siteId, competitor: c } = raw as unknown as {
              siteId: string;
              competitor: z.infer<typeof schemas.competitorsResponse>[number];
            };
            out.push(
              rec("competitors", `${siteId}:${c.id}`, {
                siteId,
                competitorExternalId: c.id,
                name: c.name ?? null,
                url: c.url ?? null,
                domainTrust: c.domain_trust,
              }),
            );
            break;
          }
          case "backlinks": {
            const { siteId, stats } = raw as unknown as {
              siteId: string;
              stats: z.infer<typeof schemas.backlinkStatsResponse>;
            };
            out.push(
              rec("backlinks", `${siteId}:stats`, {
                siteId,
                total: stats.total,
                domains: stats.domains,
                anchors: stats.anchors,
                ip: stats.ip,
                dofollow: stats.dofollow,
                nofollow: stats.nofollow,
                remainingDailyAdds: stats.limit,
              }),
            );
            break;
          }
          case "audit": {
            const { siteId, audit: a } = raw as unknown as {
              siteId: string;
              audit: z.infer<typeof schemas.auditsResponse>["items"][number];
            };
            out.push(
              rec("audits", `${siteId}:${a.id}`, {
                siteId,
                auditExternalId: a.id,
                title: a.title ?? null,
                url: a.url ?? null,
                status: a.status ?? null,
                lastUpdate: a.last_update ?? null,
                score: a.stats?.score ?? null,
                errors: a.stats?.errors ?? null,
                warnings: a.stats?.warnings ?? null,
                notices: a.stats?.notices ?? null,
                crawled: a.stats?.crawled ?? null,
              }),
            );
            break;
          }
          case "report": {
            const { siteId, auditId, report, samples } = raw as unknown as {
              siteId: string;
              auditId: string;
              report: z.infer<typeof schemas.reportResponse>;
              samples: Record<string, string[]>;
            };
            const checks = (report.sections ?? []).flatMap((s) =>
              (s.props ?? []).map((c) => ({ section: s.name ?? null, ...c })),
            );
            for (const c of checks) {
              out.push(
                rec("audit_issues", `${siteId}:${c.code}`, {
                  siteId,
                  auditExternalId: auditId,
                  code: c.code,
                  name: c.name ?? c.code,
                  section: c.section,
                  status: c.status,
                  pagesAffected: c.value ?? 0,
                  sampleUrls: samples[c.code] ?? [],
                }),
              );
            }
            // Marks the report as complete so checks that vanished from it can be recognised as fixed.
            out.push(
              rec("audit_reports", `${siteId}:${auditId}`, {
                siteId,
                auditExternalId: auditId,
                checks: checks.length,
                score: report.score_percent,
                pages: report.total_pages,
              }),
            );
            break;
          }
        }
      }
      return out;
    },

    mapError: toProviderError,
  };

  async function auditsPage(
    credentials: Credentials,
    request: PageRequest,
    ctx: AdapterContext,
  ): Promise<Page<unknown>> {
    const { projects } = settingsOf(ctx);
    if (projects.length === 0) return { items: [], nextCursor: null };
    const linked = new Set(projects.map((p) => p.siteId));
    const cursor = decode(request.cursor);

    if (cursor.phase === "report") {
      const queue = cursor.queue ?? [];
      const i = cursor.i ?? 0;
      const target = queue[i];
      if (!target) return { items: [], nextCursor: null };
      const report = parse(
        schemas.reportResponse,
        await get(credentials, `${AUDIT}/report`, { audit_id: target.auditId }),
        "the audit report",
      );
      const items: Item[] = [];
      if (report.is_finished !== false) {
        const checks = (report.sections ?? [])
          .flatMap((s) => s.props ?? [])
          .filter((c) => (c.status === "error" || c.status === "warning") && (c.value ?? 0) > 0);
        checks.sort((a, b) =>
          a.status === b.status ? (b.value ?? 0) - (a.value ?? 0) : a.status === "error" ? -1 : 1,
        );
        const samples: Record<string, string[]> = {};
        for (const c of checks.slice(0, MAX_ISSUE_URL_LOOKUPS)) {
          try {
            const pages = parse(
              schemas.issuePagesResponse,
              await get(credentials, `${AUDIT}/issue-pages`, {
                audit_id: target.auditId,
                code: c.code,
                limit: SAMPLE_URLS_PER_ISSUE,
                offset: 0,
              }),
              "affected pages",
            );
            samples[c.code] = (pages.urls ?? []).slice(0, SAMPLE_URLS_PER_ISSUE);
          } catch (error) {
            // Example URLs are a bonus: a failure here must not lose the issue itself, unless the key is bad.
            const mapped = toProviderError(error);
            if (mapped.needsReconnect) throw mapped;
          }
        }
        items.push({
          kind: "report",
          siteId: target.siteId,
          auditId: target.auditId,
          report,
          samples,
        });
      }
      return {
        items,
        nextCursor: i + 1 < queue.length ? encode({ phase: "report", queue, i: i + 1 }) : null,
      };
    }

    const offset = cursor.offset ?? 0;
    const body = parse(
      schemas.auditsResponse,
      await get(credentials, AUDIT, { limit: AUDITS_PAGE, offset }),
      "the audit list",
    );
    const best = { ...(cursor.best ?? {}) };
    const items: Item[] = [];
    for (const a of body.items) {
      if (!a.site_id || !linked.has(a.site_id)) continue;
      items.push({ kind: "audit", siteId: a.site_id, audit: a });
      if (a.status === "finished") {
        const at = a.last_update ?? "";
        const current = best[a.site_id];
        if (!current || at > current.at || (at === current.at && Number(a.id) > Number(current.id)))
          best[a.site_id] = { id: a.id, at };
      }
    }
    const seen = offset + body.items.length;
    if (body.items.length > 0 && seen < (body.total ?? 0))
      return { items, nextCursor: encode({ phase: "list", offset: seen, best }) };
    const queue = Object.entries(best).map(([siteId, v]) => ({ siteId, auditId: v.id }));
    return {
      items,
      nextCursor: queue.length > 0 ? encode({ phase: "report", queue, i: 0 }) : null,
    };
  }
}
