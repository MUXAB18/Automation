import { ProviderError, toProviderError } from "../../framework/errors";
import { PROVIDERS } from "../../framework/providers";
import type {
  ConnectionTestResult,
  NormalizedRecord,
  Page,
  ProviderAdapter,
} from "../../framework/types";
import { createGoogleHttp, type GoogleHttpDeps } from "./http";
import {
  GA4_ADMIN_BASE,
  GA4_BREAKDOWN_METRICS,
  GA4_DATA_BASE,
  GA4_MIN_HOURLY_TOKENS,
  GA4_PROVISIONAL_DAYS,
  GA4_SCOPE,
  GA4_TOTAL_METRICS,
  TOP_ROWS_PER_DAY,
  GOOGLE_WINDOW_DAYS,
  type GoogleOAuthConfig,
} from "./config";
import { accountSummariesResponse, ga4ReportResponse } from "./schemas";
import {
  addDays,
  fromGa4Date,
  invalid,
  metricsRecord,
  perSource,
  problemRecord,
  startDay,
  ymd,
  type Item,
} from "./shared";
import type { z } from "zod";

type Report = {
  set: string;
  dimensions: string[];
  metrics: Record<string, string>;
  /** One day per request (top rows per day) instead of a date-grouped window. */
  daily?: boolean;
};

const REPORTS: Record<string, Report> = {
  ga4_totals: {
    set: "totals",
    dimensions: ["date"],
    metrics: GA4_TOTAL_METRICS,
  },
  ga4_channels: {
    set: "channel",
    dimensions: ["date", "sessionDefaultChannelGroup"],
    metrics: GA4_BREAKDOWN_METRICS,
  },
  ga4_landing_pages: {
    set: "landing_page",
    dimensions: ["landingPage"],
    metrics: GA4_BREAKDOWN_METRICS,
    daily: true,
  },
};

const DIMENSION_NAME: Record<string, string> = {
  sessionDefaultChannelGroup: "channel",
  landingPage: "page",
};

export function createGa4Adapter(
  oauth: GoogleOAuthConfig | null,
  deps: GoogleHttpDeps & { today?: () => Date } = {},
): ProviderAdapter {
  const descriptor = PROVIDERS.find((p) => p.key === "google_analytics_4")!;
  const http = createGoogleHttp(oauth, deps);
  const today = () => ymd(deps.today?.() ?? new Date());

  return {
    descriptor: { ...descriptor, live: true },
    isMock: false,
    credentialFields: [],

    async testConnection(credentials): Promise<ConnectionTestResult> {
      try {
        const props = await listProperties(credentials);
        return {
          ok: true,
          // One Google connection per client and provider; the Google account itself is not looked up.
          externalAccountId: "google",
          displayName: `Google Analytics 4 (${props.length} propert${props.length === 1 ? "y" : "ies"})`,
          grantedScopes: [GA4_SCOPE],
        };
      } catch (error) {
        return { ok: false, error: toProviderError(error) };
      }
    },

    async fetchPage(credentials, request, ctx): Promise<Page<unknown>> {
      if (request.resource === "properties") {
        const props = await listProperties(credentials);
        return { items: props.map((p) => ({ kind: "property", ...p })), nextCursor: null };
      }
      const report = REPORTS[request.resource];
      if (!report)
        throw new ProviderError(
          "invalid_request",
          `Google Analytics has no resource named ${request.resource}.`,
        );

      return perSource(request, ctx, async (source, cursor) => {
        // The previous page told us how many hourly tokens were left; stop before running the property dry.
        if (cursor.q !== undefined && cursor.q < GA4_MIN_HOURLY_TOKENS)
          throw new ProviderError(
            "quota_exhausted",
            "The property's hourly Google Analytics quota is nearly used up. The rest is read next sync.",
            { retryAfterMs: 900_000 },
          );
        const end = addDays(today(), -1);
        const start = cursor.from ?? startDay(source.dataThrough, today());
        if (start > end) return { items: [] };
        const to = report.daily
          ? start
          : addDays(start, GOOGLE_WINDOW_DAYS - 1) < end
            ? addDays(start, GOOGLE_WINDOW_DAYS - 1)
            : end;

        const body = parseReport(
          await http.request(
            credentials,
            GA4_SCOPE,
            `${GA4_DATA_BASE}/properties/${encodeURIComponent(source.externalId)}:runReport`,
            {
              body: {
                dateRanges: [{ startDate: start, endDate: to }],
                dimensions: report.dimensions.map((name) => ({ name })),
                metrics: Object.keys(report.metrics).map((name) => ({ name })),
                ...(report.daily
                  ? {
                      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
                      limit: TOP_ROWS_PER_DAY,
                    }
                  : { limit: 250_000 }),
                returnPropertyQuota: true,
              },
            },
          ),
        );
        const items: Item[] = (body.rows ?? []).map((row) => ({
          kind: "ga4_row",
          sourceKey: source.externalId,
          set: report.set,
          // Daily reports have no date dimension: the whole request is that one day.
          day: report.daily ? start : fromGa4Date(row.dimensionValues?.[0]?.value ?? ""),
          dimensions: Object.fromEntries(
            report.dimensions
              .filter((d) => d !== "date")
              .map((d, i) => [
                DIMENSION_NAME[d] ?? d,
                row.dimensionValues?.[i + (report.daily ? 0 : 1)]?.value ?? "",
              ]),
          ),
          metrics: Object.fromEntries(
            Object.keys(report.metrics).map((m, i) => [m, row.metricValues?.[i]?.value ?? null]),
          ),
        }));
        const remaining = body.propertyQuota?.tokensPerHour?.remaining ?? undefined;
        const nextFrom = addDays(to, 1);
        return {
          items,
          next:
            nextFrom <= end
              ? {
                  s: cursor.s ?? 0,
                  from: nextFrom,
                  ...(remaining !== undefined && remaining !== null ? { q: remaining } : {}),
                }
              : undefined,
        };
      });
    },

    normalize(resource, items): NormalizedRecord[] {
      const report = REPORTS[resource];
      const out: NormalizedRecord[] = [];
      for (const raw of items as Item[]) {
        if (raw.kind === "property") {
          out.push({
            resource: "properties",
            externalId: String(raw.propertyId),
            occurredAt: null,
            source: "live",
            data: {
              kind: "ga4",
              displayName: raw.displayName ?? null,
              accountName: raw.accountName ?? null,
              propertyType: raw.propertyType ?? null,
              permissionLevel: null,
            },
          });
        } else if (raw.kind === "problem") {
          out.push(problemRecord(raw, "ga4"));
        } else if (raw.kind === "ga4_row" && report) {
          const dimensions = raw.dimensions as Record<string, string>;
          // "(other)" is Google's bucket for rows beyond its cardinality limit: not a real page or channel.
          if (Object.values(dimensions).includes("(other)")) continue;
          const day = String(raw.day);
          const values: Record<string, number | null> = {};
          for (const [api, key] of Object.entries(report.metrics)) {
            const v = (raw.metrics as Record<string, string | null>)[api];
            values[key] =
              v === null || v === undefined || v === "" || !Number.isFinite(Number(v))
                ? null
                : Number(v);
          }
          out.push(
            metricsRecord({
              resource,
              sourceKey: String(raw.sourceKey),
              kind: "ga4",
              set: report.set,
              day,
              dimensions,
              values,
              isFinal: day < addDays(today(), -GA4_PROVISIONAL_DAYS),
            }),
          );
        }
      }
      return out;
    },

    mapError: toProviderError,
  };

  async function listProperties(credentials: Record<string, string>) {
    const out: {
      propertyId: string;
      displayName: string | null;
      accountName: string | null;
      propertyType: string | null;
    }[] = [];
    let pageToken: string | undefined;
    do {
      const url = `${GA4_ADMIN_BASE}/accountSummaries?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
      const parsed = accountSummariesResponse.safeParse(
        await http.request(credentials, GA4_SCOPE, url),
      );
      if (!parsed.success) throw invalid("the property list");
      for (const account of parsed.data.accountSummaries ?? [])
        for (const p of account.propertySummaries ?? [])
          out.push({
            propertyId: p.property.replace(/^properties\//, ""),
            displayName: p.displayName ?? null,
            accountName: account.displayName ?? null,
            propertyType: p.propertyType ?? null,
          });
      pageToken = parsed.data.nextPageToken || undefined;
    } while (pageToken);
    return out;
  }
}

function parseReport(data: unknown): z.infer<typeof ga4ReportResponse> {
  const parsed = ga4ReportResponse.safeParse(data);
  if (!parsed.success) throw invalid("the report");
  return parsed.data;
}
