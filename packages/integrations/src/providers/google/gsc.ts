import { ProviderError, toProviderError } from "../../framework/errors";
import { PROVIDERS } from "../../framework/providers";
import type {
  ConnectionTestResult,
  NormalizedRecord,
  Page,
  ProviderAdapter,
} from "../../framework/types";
import {
  GSC_BASE,
  GSC_METRICS,
  GSC_SCOPE,
  TOP_ROWS_PER_DAY,
  GOOGLE_WINDOW_DAYS,
  type GoogleOAuthConfig,
} from "./config";
import { createGoogleHttp, type GoogleHttpDeps } from "./http";
import { gscQueryResponse, gscSitesResponse } from "./schemas";
import {
  addDays,
  invalid,
  metricsRecord,
  perSource,
  problemRecord,
  startDay,
  ymd,
  type Item,
} from "./shared";

type Report = { set: string; dimensions: string[]; daily?: boolean };

const REPORTS: Record<string, Report> = {
  gsc_totals: { set: "totals", dimensions: ["date"] },
  gsc_devices: { set: "device", dimensions: ["date", "device"] },
  gsc_pages: { set: "page", dimensions: ["page"], daily: true },
  gsc_queries: { set: "query", dimensions: ["query"], daily: true },
};

const FALLBACK_LAG = 0;

/** Site URLs ("sc-domain:example.com", "https://example.com/") go into the path percent-encoded. */
const siteUrlPath = (siteUrl: string) => encodeURIComponent(siteUrl);

export function createSearchConsoleAdapter(
  oauth: GoogleOAuthConfig | null,
  deps: GoogleHttpDeps & { today?: () => Date } = {},
): ProviderAdapter {
  const descriptor = PROVIDERS.find((p) => p.key === "google_search_console")!;
  const http = createGoogleHttp(oauth, deps);
  const today = () => ymd(deps.today?.() ?? new Date());

  async function listSites(credentials: Record<string, string>) {
    const parsed = gscSitesResponse.safeParse(
      await http.request(credentials, GSC_SCOPE, `${GSC_BASE}/sites`),
    );
    if (!parsed.success) throw invalid("the site list");
    return parsed.data.siteEntry ?? [];
  }

  return {
    descriptor: { ...descriptor, live: true },
    isMock: false,
    credentialFields: [],

    async testConnection(credentials): Promise<ConnectionTestResult> {
      try {
        const sites = await listSites(credentials);
        return {
          ok: true,
          externalAccountId: "google",
          displayName: `Search Console (${sites.length} site${sites.length === 1 ? "" : "s"})`,
          grantedScopes: [GSC_SCOPE],
        };
      } catch (error) {
        return { ok: false, error: toProviderError(error) };
      }
    },

    async fetchPage(credentials, request, ctx): Promise<Page<unknown>> {
      if (request.resource === "properties") {
        const sites = await listSites(credentials);
        return {
          items: sites.map((s) => ({
            kind: "property",
            siteUrl: s.siteUrl,
            permissionLevel: s.permissionLevel ?? null,
          })),
          nextCursor: null,
        };
      }
      const report = REPORTS[request.resource];
      if (!report)
        throw new ProviderError(
          "invalid_request",
          `Search Console has no resource named ${request.resource}.`,
        );

      return perSource(request, ctx, async (source, cursor) => {
        // Final data lags by about two to three days; asking up to yesterday simply returns what exists.
        const end = addDays(today(), -1 - FALLBACK_LAG);
        const start = cursor.from ?? startDay(source.dataThrough, today());
        if (start > end) return { items: [] };
        const to = report.daily
          ? start
          : addDays(start, GOOGLE_WINDOW_DAYS - 1) < end
            ? addDays(start, GOOGLE_WINDOW_DAYS - 1)
            : end;
        const body = gscQueryResponse.safeParse(
          await http.request(
            credentials,
            GSC_SCOPE,
            `${GSC_BASE}/sites/${siteUrlPath(source.externalId)}/searchAnalytics/query`,
            {
              body: {
                startDate: start,
                endDate: to,
                dimensions: report.dimensions,
                rowLimit: report.daily ? TOP_ROWS_PER_DAY : 25_000,
                startRow: 0,
                // "final" only: provisional fresh data is never stored as if it were settled.
                dataState: "final",
              },
            },
          ),
        );
        if (!body.success) throw invalid("search analytics rows");
        const items: Item[] = (body.data.rows ?? []).map((row) => ({
          kind: "gsc_row",
          sourceKey: source.externalId,
          day: report.daily ? start : (row.keys?.[0] ?? ""),
          dimensions: Object.fromEntries(
            report.dimensions
              .filter((d) => d !== "date")
              .map((d, i) => [d, row.keys?.[i + (report.daily ? 0 : 1)] ?? ""]),
          ),
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position,
        }));
        const nextFrom = addDays(to, 1);
        return { items, next: nextFrom <= end ? { s: cursor.s ?? 0, from: nextFrom } : undefined };
      });
    },

    normalize(resource, items): NormalizedRecord[] {
      const report = REPORTS[resource];
      const out: NormalizedRecord[] = [];
      for (const raw of items as Item[]) {
        if (raw.kind === "property") {
          out.push({
            resource: "properties",
            externalId: String(raw.siteUrl),
            occurredAt: null,
            source: "live",
            data: {
              kind: "search_console",
              displayName: String(raw.siteUrl),
              accountName: null,
              propertyType: String(raw.siteUrl).startsWith("sc-domain:") ? "domain" : "url_prefix",
              permissionLevel: raw.permissionLevel ?? null,
            },
          });
        } else if (raw.kind === "problem") {
          out.push(problemRecord(raw, "search_console"));
        } else if (raw.kind === "gsc_row" && report) {
          const day = String(raw.day);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
          out.push(
            metricsRecord({
              resource,
              sourceKey: String(raw.sourceKey),
              kind: "search_console",
              set: report.set,
              day,
              dimensions: raw.dimensions as Record<string, string>,
              values: {
                [GSC_METRICS.clicks]: raw.clicks as number | null,
                [GSC_METRICS.impressions]: raw.impressions as number | null,
                [GSC_METRICS.ctr]: raw.ctr as number | null,
                [GSC_METRICS.position]: raw.position as number | null,
              },
              isFinal: true,
            }),
          );
        }
      }
      return out;
    },

    mapError: toProviderError,
  };
}
