import { z } from "zod";

/** Tolerant response shapes: only fields named in the official docs are read; unknown fields are ignored. */

const s = z.string().nullish();
const num = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });

export const accountSummariesResponse = z.object({
  accountSummaries: z
    .array(
      z.object({
        displayName: s,
        propertySummaries: z
          .array(z.object({ property: z.string(), displayName: s, propertyType: s }))
          .nullish(),
      }),
    )
    .nullish(),
  nextPageToken: s,
});

export const ga4ReportResponse = z.object({
  rows: z
    .array(
      z.object({
        dimensionValues: z.array(z.object({ value: z.string().nullish() })).nullish(),
        metricValues: z.array(z.object({ value: z.string().nullish() })).nullish(),
      }),
    )
    .nullish(),
  rowCount: num,
  propertyQuota: z
    .object({
      tokensPerHour: z.object({ consumed: num, remaining: num }).nullish(),
      tokensPerDay: z.object({ consumed: num, remaining: num }).nullish(),
    })
    .nullish(),
});

export const gscSitesResponse = z.object({
  siteEntry: z.array(z.object({ siteUrl: z.string(), permissionLevel: s })).nullish(),
});

export const gscQueryResponse = z.object({
  rows: z
    .array(
      z.object({
        keys: z.array(z.string()).nullish(),
        clicks: num,
        impressions: num,
        ctr: num,
        position: num,
      }),
    )
    .nullish(),
});

export const settingsSchema = z.object({
  sources: z.array(
    z.object({ externalId: z.string().min(1), dataThrough: z.string().nullable().default(null) }),
  ),
});
