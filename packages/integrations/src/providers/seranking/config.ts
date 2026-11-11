/**
 * SE Ranking Project API + Website Audit API. Values below were read from the official documentation
 * (seranking.com/api); `docs/integrations-seranking.md` lists what was confirmed and what was not.
 */

export const SERANKING_API_BASE = "https://api.seranking.com";

/** Documented: "no more than 5 times per second" for any method; repeated excess means a 10 minute block. */
export const SERANKING_MIN_INTERVAL_MS = 250;

/** First sync reads this many days of ranking history; later syncs continue from the stored day. */
export const BACKFILL_DAYS = 90;
/** Later syncs re-read this many days before the stored day, in case the provider corrected a check. */
export const OVERLAP_DAYS = 7;
/** The positions endpoint documents no maximum range, so history is read in windows. */
export const WINDOW_DAYS = 30;

export const MAX_ISSUE_URL_LOOKUPS = 30;
export const SAMPLE_URLS_PER_ISSUE = 20;
export const AUDITS_PAGE = 100;

export type SeRankingConfig = { apiBase?: string };

/** What the worker tells the adapter about the account: only linked, enabled projects are synced. */
export type SeRankingSettings = {
  projects: {
    siteId: string;
    siteEngineId: number;
    /** YYYY-MM-DD: rankings are stored up to this day. */
    rankingsThrough: string | null;
  }[];
};

export const SERANKING_RESOURCES = [
  "projects",
  "keywords",
  "rankings",
  "project_summary",
  "audits",
  "competitors",
  "backlinks",
] as const;
