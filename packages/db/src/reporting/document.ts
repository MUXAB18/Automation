import { createHash } from "node:crypto";
import { z } from "zod";
import type { Metric, MetricsResult } from "./metrics";

/** The shape of every metric in a report. Anything that fails it is dropped to "unavailable" instead of being shown. */
export const metricSchema = z.object({
  key: z.string(),
  label: z.string(),
  unit: z.enum(["count", "percent", "position", "seconds", "usd"]),
  value: z.number().finite().nullable(),
  previous: z.number().finite().nullable(),
  changePct: z.number().finite().nullable(),
  state: z.enum(["ok", "partial", "no_data", "no_source"]),
  note: z.string().optional(),
});

const range: Record<string, [number, number]> = {
  "gsc.ctr": [0, 100],
  "ga4.engagement_rate": [0, 100],
  "gsc.position": [1, 1000],
};

/** Validate one metric: right shape, finite, not negative, and inside the range its meaning allows. */
export function validMetric(m: Metric): Metric {
  const parsed = metricSchema.safeParse(m);
  const bad = (reason: string): Metric => ({
    ...m,
    value: null,
    previous: null,
    changePct: null,
    state: "no_data",
    note: `Not shown: ${reason}.`,
  });
  if (!parsed.success) return bad("the stored value failed validation");
  const v = parsed.data;
  if (v.value === null) return v;
  const r = range[v.key];
  if (v.value < 0 || (r && (v.value < r[0] || v.value > r[1])))
    return bad("the value is outside its possible range");
  if (v.previous !== null && v.previous < 0) return { ...v, previous: null, changePct: null };
  return v;
}

export function validateAll(m: MetricsResult): MetricsResult {
  const v = validMetric;
  return {
    ...m,
    search: {
      ...m.search,
      clicks: v(m.search.clicks),
      impressions: v(m.search.impressions),
      ctr: v(m.search.ctr),
      position: v(m.search.position),
    },
    traffic: {
      ...m.traffic,
      sessions: v(m.traffic.sessions),
      organicSessions: v(m.traffic.organicSessions),
      engagedSessions: v(m.traffic.engagedSessions),
      engagementRate: v(m.traffic.engagementRate),
      keyEvents: v(m.traffic.keyEvents),
    },
    social: { ...m.social, published: v(m.social.published) },
    work: {
      ...m.work,
      completed: v(m.work.completed),
      created: v(m.work.created),
      issuesResolved: v(m.work.issuesResolved),
      issuesOpenTotal: v(m.work.issuesOpenTotal),
    },
  };
}

/** Stable hash of a snapshot: the same data always hashes the same, so a report can prove what it was built from. */
export function hashData(data: unknown): string {
  const canon = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(canon)
      : x && typeof x === "object"
        ? Object.fromEntries(
            Object.entries(x as object)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, canon(v)]),
          )
        : x;
  return createHash("sha256")
    .update(JSON.stringify(canon(data)))
    .digest("hex");
}

export const SECTION_KEYS = [
  "summary",
  "seo",
  "search_traffic",
  "social",
  "work",
  "issues",
  "recommendations",
  "data_sources",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export const SECTION_TITLE: Record<SectionKey, string> = {
  summary: "Executive summary",
  seo: "SEO performance",
  search_traffic: "Search and traffic performance",
  social: "Social media performance",
  work: "Work completed",
  issues: "Outstanding issues",
  recommendations: "Recommendations",
  data_sources: "Data sources and freshness",
};

export const templateLayoutSchema = z.object({
  sections: z
    .array(z.object({ key: z.enum(SECTION_KEYS), enabled: z.boolean().default(true) }))
    .min(1),
  defaultIntervalDays: z.number().int().min(1).max(92).default(15),
  /** Let an AI model write the executive summary from the figures (otherwise a plain, fixed-wording summary is used). */
  useAi: z.boolean().default(false),
  titlePattern: z
    .string()
    .trim()
    .min(3)
    .max(120)
    .default("{{client}} performance report: {{period}}"),
});
export type TemplateLayout = z.output<typeof templateLayoutSchema>;
export const DEFAULT_LAYOUT: TemplateLayout = {
  sections: SECTION_KEYS.map((key) => ({ key, enabled: true })),
  defaultIntervalDays: 15,
  useAi: false,
  titlePattern: "{{client}} performance report: {{period}}",
};

export type Recommendation = { title: string; reason: string };
export type SourceNote = {
  label: string;
  client: string;
  dataThrough: string | null;
  lastSyncedAt: string | null;
  stale: boolean;
};

/** What the preview, the PDF and the email all render. Built only from stored sections. */
export type ReportView = {
  id: string;
  title: string;
  status: string;
  clientName: string;
  timezone: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string | null;
  revision: number;
  sections: {
    key: SectionKey;
    title: string;
    content: Record<string, unknown>;
    aiGenerated: boolean;
  }[];
};

export const periodLabel = (start: string, end: string) => `${start} to ${end}`;
