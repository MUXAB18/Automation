/**
 * Google Analytics 4 (Data API v1beta + Admin API v1beta) and Search Console (webmasters v3).
 * Values were read from the official documentation (developers.google.com); see
 * `docs/integrations-google.md` for what was confirmed and what was not.
 */

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export const GA4_ADMIN_BASE = "https://analyticsadmin.googleapis.com/v1beta";
export const GA4_DATA_BASE = "https://analyticsdata.googleapis.com/v1beta";
export const GSC_BASE = "https://www.googleapis.com/webmasters/v3";

/** The platform's Google OAuth client (platform-wide environment variables, never per client). */
export type GoogleOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };

/**
 * Stored (encrypted) per connected provider account. Two supported methods:
 *  - oauth: a person signed in with Google; only the long-lived refresh token is kept.
 *  - service_account: a service account key; the account's email must be added as a user on the property.
 */
export type GoogleCredentials =
  | { kind: "oauth"; refreshToken: string; scope: string }
  | { kind: "service_account"; clientEmail: string; privateKey: string };

/** First sync reads this many days; later syncs continue from the last stored day. */
export const GOOGLE_BACKFILL_DAYS = 90;
/** Re-read this many days before the stored day: recent days are revised after first being reported. */
export const GOOGLE_OVERLAP_DAYS = 3;
/** Date-grouped reports are read in windows of this many days. */
export const GOOGLE_WINDOW_DAYS = 30;
/** Top pages and queries are read one day at a time so every day has its own top rows. */
export const TOP_ROWS_PER_DAY = 500;

/** GA4 reports "processing" data for roughly a day or two: recent days are stored as provisional. */
export const GA4_PROVISIONAL_DAYS = 2;

/** Stop a GA4 sync when the property's remaining hourly tokens fall below this (cost per report varies). */
export const GA4_MIN_HOURLY_TOKENS = 2_000;

/** What the worker tells an adapter about the account's selected properties. */
export type GoogleSettings = {
  sources: {
    /** GA4 numeric property id, or the Search Console site URL ("sc-domain:example.com"). */
    externalId: string;
    /** YYYY-MM-DD: data is stored up to this day. */
    dataThrough: string | null;
  }[];
};

/** Which metric keys each report produces (the catalogue lives in @automation/db). */
export const GA4_TOTAL_METRICS = {
  sessions: "ga4.sessions",
  totalUsers: "ga4.total_users",
  newUsers: "ga4.new_users",
  engagedSessions: "ga4.engaged_sessions",
  engagementRate: "ga4.engagement_rate",
  averageSessionDuration: "ga4.avg_session_duration",
  bounceRate: "ga4.bounce_rate",
  screenPageViews: "ga4.page_views",
  keyEvents: "ga4.key_events",
} as const;

export const GA4_BREAKDOWN_METRICS = {
  sessions: "ga4.sessions",
  engagedSessions: "ga4.engaged_sessions",
  keyEvents: "ga4.key_events",
} as const;

export const GSC_METRICS = {
  clicks: "gsc.clicks",
  impressions: "gsc.impressions",
  ctr: "gsc.ctr",
  position: "gsc.position",
} as const;
