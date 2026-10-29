import { z } from "zod";
import { googleJson, type HttpOptions } from "./google-http";

const ADMIN_BASE = "https://analyticsadmin.googleapis.com/v1beta";
const DATA_BASE = "https://analyticsdata.googleapis.com/v1beta";

const summariesResponse = z.object({
  accountSummaries: z
    .array(
      z.object({
        displayName: z.string().optional(),
        propertySummaries: z
          .array(z.object({ property: z.string(), displayName: z.string().optional() }))
          .default([]),
      }),
    )
    .default([]),
  nextPageToken: z.string().optional(),
});

const reportResponse = z.object({
  rows: z
    .array(
      z.object({
        dimensionValues: z.array(z.object({ value: z.string() })).default([]),
        metricValues: z.array(z.object({ value: z.string() })).default([]),
      }),
    )
    .default([]),
  rowCount: z.number().optional(),
});

export type Ga4Property = { propertyId: string; displayName: string; accountName: string };

/** Every GA4 property the connected Google account can see (for the property picker). */
export async function listGa4Properties(
  accessToken: string,
  http?: HttpOptions,
): Promise<Ga4Property[]> {
  const out: Ga4Property[] = [];
  let pageToken: string | undefined;
  do {
    const url = `${ADMIN_BASE}/accountSummaries?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const body = summariesResponse.parse(await googleJson(url, accessToken, {}, http));
    for (const account of body.accountSummaries) {
      for (const p of account.propertySummaries) {
        out.push({
          propertyId: p.property.replace(/^properties\//, ""),
          displayName: p.displayName ?? p.property,
          accountName: account.displayName ?? "",
        });
      }
    }
    pageToken = body.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

export type Ga4Report = {
  propertyId: string;
  /** Inclusive, YYYY-MM-DD. */
  startDate: string;
  endDate: string;
  dimensions: readonly string[];
  metrics: readonly string[];
  maxRows?: number;
};

export type Ga4Row = { dimensions: Record<string, string>; metrics: Record<string, number> };

const PAGE_SIZE = 100_000;

export async function runGa4Report(
  accessToken: string,
  report: Ga4Report,
  http?: HttpOptions,
): Promise<Ga4Row[]> {
  if (!/^\d+$/.test(report.propertyId)) throw new Error("GA4 propertyId must be numeric");
  const maxRows = report.maxRows ?? 500_000;
  const out: Ga4Row[] = [];
  const url = `${DATA_BASE}/properties/${report.propertyId}:runReport`;

  for (let offset = 0; out.length < maxRows; offset += PAGE_SIZE) {
    const page = reportResponse.parse(
      await googleJson(
        url,
        accessToken,
        {
          body: {
            dateRanges: [{ startDate: report.startDate, endDate: report.endDate }],
            dimensions: report.dimensions.map((name) => ({ name })),
            metrics: report.metrics.map((name) => ({ name })),
            limit: Math.min(PAGE_SIZE, maxRows - out.length),
            offset,
          },
        },
        http,
      ),
    );
    for (const row of page.rows) {
      out.push({
        dimensions: Object.fromEntries(
          report.dimensions.map((d, i) => [d, row.dimensionValues[i]?.value ?? ""]),
        ),
        metrics: Object.fromEntries(
          report.metrics.map((m, i) => [m, Number(row.metricValues[i]?.value ?? 0)]),
        ),
      });
    }
    if (page.rows.length < PAGE_SIZE) break;
  }
  return out;
}
