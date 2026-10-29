import { z } from "zod";
import { googleJson, type HttpOptions } from "./google-http";

const BASE = "https://www.googleapis.com/webmasters/v3";
const PAGE_SIZE = 25_000;

const sitesResponse = z.object({
  siteEntry: z.array(z.object({ siteUrl: z.string(), permissionLevel: z.string() })).default([]),
});

const analyticsResponse = z.object({
  rows: z
    .array(
      z.object({
        keys: z.array(z.string()).default([]),
        clicks: z.number(),
        impressions: z.number(),
        ctr: z.number(),
        position: z.number(),
      }),
    )
    .default([]),
});

export type GscSite = { siteUrl: string; permissionLevel: string };
export type GscDimension = "date" | "query" | "page" | "country" | "device";
export type GscRow = {
  /** Dimension values keyed by dimension name. */
  dimensions: Partial<Record<GscDimension, string>>;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export async function listGscSites(accessToken: string, http?: HttpOptions): Promise<GscSite[]> {
  const body = sitesResponse.parse(await googleJson(`${BASE}/sites`, accessToken, {}, http));
  return body.siteEntry;
}

export type GscQuery = {
  siteUrl: string;
  /** Inclusive, YYYY-MM-DD. */
  startDate: string;
  endDate: string;
  dimensions: readonly GscDimension[];
  /** Safety cap on total rows returned across pages. */
  maxRows?: number;
};

/** Fetch all Search Analytics rows for the query, paging until exhausted or maxRows is reached. */
export async function querySearchAnalytics(
  accessToken: string,
  query: GscQuery,
  http?: HttpOptions,
): Promise<GscRow[]> {
  const maxRows = query.maxRows ?? 250_000;
  const out: GscRow[] = [];
  const url = `${BASE}/sites/${encodeURIComponent(query.siteUrl)}/searchAnalytics/query`;

  for (let startRow = 0; out.length < maxRows; startRow += PAGE_SIZE) {
    const page = analyticsResponse.parse(
      await googleJson(
        url,
        accessToken,
        {
          body: {
            startDate: query.startDate,
            endDate: query.endDate,
            dimensions: query.dimensions,
            rowLimit: Math.min(PAGE_SIZE, maxRows - out.length),
            startRow,
            dataState: "final",
          },
        },
        http,
      ),
    );
    for (const row of page.rows) {
      out.push({
        dimensions: Object.fromEntries(query.dimensions.map((d, i) => [d, row.keys[i] ?? ""])),
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
      });
    }
    if (page.rows.length < PAGE_SIZE) break;
  }
  return out;
}
