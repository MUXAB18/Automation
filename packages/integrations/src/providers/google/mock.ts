import { ProviderError, errorFromStatus, toProviderError } from "../../framework/errors";
import { PROVIDERS } from "../../framework/providers";
import type {
  ConnectionTestResult,
  CredentialField,
  NormalizedRecord,
  Page,
  ProviderAdapter,
} from "../../framework/types";
import { MOCK_SCENARIOS } from "../../framework/mock-adapter";
import { GA4_SCOPE, GSC_SCOPE, TOP_ROWS_PER_DAY, GOOGLE_WINDOW_DAYS } from "./config";
import { createGa4Adapter } from "./ga4";
import { createSearchConsoleAdapter } from "./gsc";
import { addDays, perSource, startDay, ymd, type Item } from "./shared";

/**
 * Development stand-in for Google. It makes no network calls and produces deterministic, plausible
 * numbers shaped exactly like the real API responses, so the real normalisation and storage code runs.
 * Everything it produces is tagged "mock" and the dashboards label it as such.
 */

const FIELDS: readonly CredentialField[] = [
  {
    name: "scenario",
    label: "Scenario",
    secret: false,
    required: true,
    options: [
      ...MOCK_SCENARIOS,
      { value: "access_denied", label: "Property not accessible (tests per-property errors)" },
    ],
    help: "Development mock only: no Google service is contacted and the numbers are made up.",
  },
];

/** Deterministic pseudo-random number in [0, 1) from a string. */
function rand(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100_000) / 100_000;
}

const CHANNELS = ["Organic Search", "Direct", "Referral", "Paid Search", "Organic Social"];
const PAGES = [
  "/",
  "/services/freight-forwarding",
  "/services/customs-brokerage",
  "/blog/incoterms-guide",
  "/about",
  "/contact",
  "/quote",
  "/blog/shipping-costs",
  "/locations/ottawa",
  "/locations/toronto",
];
const QUERIES = [
  "freight forwarding ottawa",
  "customs broker canada",
  "incoterms 2020",
  "shipping to usa from canada",
  "sarj worldwide",
  "ltl freight quote",
  "how to import goods",
  "air freight rates",
  "cross border shipping",
  "customs clearance fees",
];

const ga4Metrics = (day: string, share = 1, key = ""): Record<string, string> => {
  const sessions = Math.round((700 + rand(`${day}s${key}`) * 500) * share);
  const engaged = Math.round(sessions * (0.5 + rand(`${day}e${key}`) * 0.2));
  return {
    sessions: String(sessions),
    totalUsers: String(Math.round(sessions * 0.78)),
    newUsers: String(Math.round(sessions * 0.42)),
    engagedSessions: String(engaged),
    engagementRate: String(engaged / Math.max(sessions, 1)),
    averageSessionDuration: String(60 + rand(`${day}d${key}`) * 80),
    bounceRate: String(1 - engaged / Math.max(sessions, 1)),
    screenPageViews: String(Math.round(sessions * 1.9)),
    keyEvents: String(Math.round(sessions * 0.03)),
  };
};

const gscMetrics = (day: string, share = 1, key = "") => {
  const impressions = Math.round((4000 + rand(`${day}i${key}`) * 2500) * share);
  const clicks = Math.round(impressions * (0.025 + rand(`${day}c${key}`) * 0.02));
  return {
    clicks,
    impressions,
    ctr: clicks / Math.max(impressions, 1),
    position: 7 + rand(`${day}p${key}`) * 6,
  };
};

export function createGoogleMockAdapter(kind: "ga4" | "search_console"): ProviderAdapter {
  const key = kind === "ga4" ? "google_analytics_4" : "google_search_console";
  const descriptor = PROVIDERS.find((p) => p.key === key)!;
  // Normalisation is the REAL code (no network is involved in normalize).
  const live = kind === "ga4" ? createGa4Adapter(null) : createSearchConsoleAdapter(null);
  const mockSource = kind === "ga4" ? "100200300" : "sc-domain:mock.example";
  const scenarioOf = (c: Record<string, string>) => c.scenario ?? "healthy";
  const today = () => ymd(new Date());
  const resources = descriptor.resources;

  return {
    descriptor,
    isMock: true,
    credentialFields: FIELDS,

    async testConnection(credentials): Promise<ConnectionTestResult> {
      const scenario = scenarioOf(credentials);
      if (scenario === "auth_failed") return { ok: false, error: errorFromStatus(401) };
      if (scenario === "rate_limited") return { ok: false, error: errorFromStatus(429, 1) };
      return {
        ok: true,
        externalAccountId: "google-mock",
        displayName: `${descriptor.name} (development mock)`,
        grantedScopes: [kind === "ga4" ? GA4_SCOPE : GSC_SCOPE],
      };
    },

    async fetchPage(credentials, request, ctx): Promise<Page<unknown>> {
      const scenario = scenarioOf(credentials);
      if (scenario === "auth_failed") throw errorFromStatus(401);
      if (scenario === "rate_limited") throw errorFromStatus(429, 0.01);
      if (scenario === "partial" && request.resource === resources[2]) throw errorFromStatus(500);
      if (request.resource === "properties") {
        return {
          items: [
            kind === "ga4"
              ? {
                  kind: "property",
                  propertyId: mockSource,
                  displayName: "Mock Website (development)",
                  accountName: "Mock Account",
                  propertyType: "PROPERTY_TYPE_ORDINARY",
                }
              : { kind: "property", siteUrl: mockSource, permissionLevel: "siteOwner" },
          ],
          nextCursor: null,
        };
      }
      return perSource(request, ctx, async (source, cursor) => {
        if (scenario === "access_denied")
          throw new ProviderError(
            "access_denied",
            "The connected Google account has no access to this property.",
          );
        const daily =
          request.resource === "ga4_landing_pages" ||
          request.resource === "gsc_pages" ||
          request.resource === "gsc_queries";
        const end = addDays(today(), -1);
        const start = cursor.from ?? startDay(source.dataThrough, today());
        if (start > end) return { items: [] };
        const to = daily
          ? start
          : addDays(start, GOOGLE_WINDOW_DAYS - 1) < end
            ? addDays(start, GOOGLE_WINDOW_DAYS - 1)
            : end;
        const days: string[] = [];
        for (let d = start; d <= to; d = addDays(d, 1)) days.push(d);
        const items: Item[] = [];
        const base = { sourceKey: source.externalId };
        for (const day of days) {
          if (kind === "ga4") {
            if (request.resource === "ga4_totals")
              items.push({
                kind: "ga4_row",
                ...base,
                set: "totals",
                day,
                dimensions: {},
                metrics: ga4Metrics(day),
              });
            if (request.resource === "ga4_channels")
              CHANNELS.forEach((c, i) =>
                items.push({
                  kind: "ga4_row",
                  ...base,
                  set: "channel",
                  day,
                  dimensions: { channel: c },
                  metrics: pick(ga4Metrics(day, [0.45, 0.25, 0.12, 0.1, 0.08][i], c), [
                    "sessions",
                    "engagedSessions",
                    "keyEvents",
                  ]),
                }),
              );
            if (request.resource === "ga4_landing_pages")
              PAGES.slice(0, Math.min(PAGES.length, TOP_ROWS_PER_DAY)).forEach((p, i) =>
                items.push({
                  kind: "ga4_row",
                  ...base,
                  set: "landing_page",
                  day,
                  dimensions: { page: p },
                  metrics: pick(ga4Metrics(day, 0.3 / (i + 1), p), [
                    "sessions",
                    "engagedSessions",
                    "keyEvents",
                  ]),
                }),
              );
          } else {
            const row = (share: number, k: string, dimensions: Record<string, string>) => ({
              kind: "gsc_row",
              ...base,
              day,
              dimensions,
              ...gscMetrics(day, share, k),
            });
            if (request.resource === "gsc_totals") items.push(row(1, "t", {}));
            if (request.resource === "gsc_devices")
              ["desktop", "mobile", "tablet"].forEach((d, i) =>
                items.push(row([0.5, 0.45, 0.05][i]!, d, { device: d })),
              );
            if (request.resource === "gsc_pages")
              PAGES.forEach((p, i) =>
                items.push(row(0.3 / (i + 1), p, { page: `https://mock.example${p}` })),
              );
            if (request.resource === "gsc_queries")
              QUERIES.forEach((q, i) => items.push(row(0.25 / (i + 1), q, { query: q })));
          }
        }
        const nextFrom = addDays(to, 1);
        return { items, next: nextFrom <= end ? { s: cursor.s ?? 0, from: nextFrom } : undefined };
      });
    },

    normalize(resource, items, ctx): NormalizedRecord[] {
      // The same normalisation as the live adapter, with everything marked as mock.
      return live.normalize(resource, items, ctx).map((r) => ({
        ...r,
        source: "mock" as const,
        data: r.resource === "properties" ? { ...r.data, mock: true } : r.data,
      }));
    },

    mapError: toProviderError,
  };
}

const pick = (o: Record<string, string>, keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, o[k]!]));
