import { z } from "zod";

/**
 * Tolerant response shapes: only fields named in the official docs are read, everything but the id is
 * optional, and unknown fields are ignored. Numbers the API sends as strings are accepted.
 */

const id = z.union([z.string(), z.number()]).transform(String);
const s = z.string().nullish();
const n = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v) => {
    if (v === null || v === undefined || v === "") return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  });

export const sitesResponse = z.array(
  z.object({
    id,
    title: s,
    name: s,
    group_id: id.nullish(),
    is_active: z.union([z.number(), z.boolean()]).nullish(),
    keyword_count: n,
  }),
);

export const enginesResponse = z.array(
  z.object({
    site_engine_id: n,
    search_engine_id: n,
    region_id: n,
    region_name: s,
    lang_code: s,
    keyword_count: n,
  }),
);

export const keywordsResponse = z.array(
  z.object({
    id,
    name: z.string(),
    link: s,
    tags: z.array(z.union([z.string(), z.number()]).transform(String)).nullish(),
  }),
);

export const positionsResponse = z.array(
  z.object({
    site_engine_id: n,
    keywords: z.array(
      z.object({
        id,
        positions: z.array(z.object({ date: z.string(), pos: n, change: n })).nullish(),
        volume: n,
        landing_pages: z.array(z.object({ url: z.string(), date: s })).nullish(),
      }),
    ),
  }),
);

export const summaryResponse = z.object({
  today_avg: n,
  yesterday_avg: n,
  total_up: n,
  total_down: n,
  top5: n,
  top10: n,
  top30: n,
  visibility: n,
  visibility_percent: n,
  da: n,
  index_google: n,
});

export const competitorsResponse = z.array(z.object({ id, name: s, url: s, domain_trust: n }));

export const auditsResponse = z.object({
  total: n,
  items: z.array(
    z.object({
      id,
      url: s,
      title: s,
      site_id: id.nullish(),
      last_update: s,
      status: s,
      stats: z.object({ score: n, errors: n, warnings: n, notices: n, crawled: n }).nullish(),
    }),
  ),
});

export const reportResponse = z.object({
  is_finished: z.boolean().nullish(),
  score_percent: n,
  total_pages: n,
  total_errors: n,
  total_warnings: n,
  total_notices: n,
  total_passed: n,
  sections: z
    .array(
      z.object({
        uid: s,
        name: s,
        props: z
          .array(z.object({ code: z.string(), status: z.string(), name: s, value: n }))
          .nullish(),
      }),
    )
    .nullish(),
});

export const issuePagesResponse = z.object({ total_urls: n, urls: z.array(z.string()).nullish() });

export const backlinkStatsResponse = z.object({
  total: n,
  anchors: n,
  ip: n,
  domains: n,
  dofollow: n,
  nofollow: n,
  limit: n,
});

export const settingsSchema = z.object({
  projects: z.array(
    z.object({
      siteId: z.string().min(1),
      siteEngineId: z.number().int(),
      rankingsThrough: z.string().nullable().default(null),
    }),
  ),
});
