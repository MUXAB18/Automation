import type { ProviderDescriptor } from "./types";

/**
 * What each provider is and offers. Facts here were checked against the providers' own documentation
 * (see `notes`); anything not confirmed is left out rather than guessed. No live adapter ships in
 * this phase, so `live` is false for all of them.
 */

export const GOOGLE_SCOPES = {
  searchConsole: "https://www.googleapis.com/auth/webmasters.readonly",
  analytics: "https://www.googleapis.com/auth/analytics.readonly",
} as const;

export const PROVIDERS: readonly ProviderDescriptor[] = [
  {
    key: "gohighlevel",
    name: "GoHighLevel",
    category: "crm",
    authType: "oauth2",
    // Webhooks exist (signed with x-wh-signature) but are not implemented yet, so data is polled.
    sync: { mode: "polling", defaultIntervalMinutes: 60 },
    // Documented: 100 requests per 10 seconds burst and 200,000 per day, per app and per location.
    rateLimit: { perSecond: 10, burst: 100 },
    // Each feature has its own scope; none is required for the connection itself.
    requiredScopes: [],
    resources: [
      "pipelines",
      "contacts",
      "opportunities",
      "conversations",
      "campaigns",
      "workflows",
      "social_accounts",
      "social_posts",
      "social_statistics",
    ],
    resourceScopes: {
      pipelines: ["opportunities.readonly"],
      contacts: ["contacts.readonly"],
      opportunities: ["opportunities.readonly"],
      conversations: ["conversations.readonly"],
      campaigns: ["campaigns.readonly"],
      workflows: ["workflows.readonly"],
      social_accounts: ["socialplanner/account.readonly"],
      social_posts: ["socialplanner/post.readonly"],
      social_statistics: ["socialplanner/account.readonly"],
    },
    canPublish: true,
    credentialFields: [],
    docsUrl: "https://marketplace.gohighlevel.com/docs/",
    notes: [
      "OAuth 2.0 install on a single location (sub-account). Access tokens last about 24 hours; refresh tokens rotate, so each refresh is stored before it is used.",
      "Documented limits: 100 requests per 10 seconds and 200,000 per day per app and location. 429 responses are retried after the interval the API reports.",
      "Every feature needs its own permission. Features whose permission was not granted are shown as unsupported, not attempted.",
      "Contacts use the paginated list endpoint, which the spec marks deprecated. There is no 'changed since' filter, so contacts are re-read in full each sync.",
      "Conversations: metadata only (message text is never stored). The search response documents no cursor, so only the latest conversations are read unless the API supplies one.",
      "Campaigns and workflows: names and status only; the API exposes no performance data for them.",
      "Social performance: the statistics endpoint reports a 7-day total per sync; per-post analytics are not offered by the endpoints reviewed.",
      "Publishing: creating a post has no documented idempotency key, so the platform never retries a request that may have reached GoHighLevel.",
    ],
    live: true,
  },
  {
    key: "se_ranking",
    name: "SE Ranking",
    category: "seo_data",
    authType: "api_key",
    sync: { mode: "polling", defaultIntervalMinutes: 360 },
    // Documented: any method at most 5 times per second; repeated excess means a 10 minute block.
    rateLimit: { perSecond: 4, burst: 4 },
    requiredScopes: [],
    resources: [
      "projects",
      "keywords",
      "rankings",
      "project_summary",
      "audits",
      "competitors",
      "backlinks",
    ],
    credentialFields: [
      {
        name: "apiKey",
        label: "API key",
        secret: true,
        required: true,
        help: "Sent as 'Authorization: Token <key>'. Create it in your SE Ranking account (API access).",
      },
    ],
    docsUrl: "https://seranking.com/api/",
    notes: [
      "API key sent as an Authorization header. No webhooks are documented, so data is polled.",
      "Limit: any method at most 5 times per second; repeated excess blocks the key for 10 minutes. The platform spaces its own calls.",
      "What is available depends on the SE Ranking plan, not the key. A feature the account cannot use is shown as unsupported instead of failing the sync.",
      "Projects are discovered automatically, but a person links each one to a platform SEO project and picks ONE search engine; only linked projects are synced.",
      "Rankings: history is read in 30-day windows (90 days on the first sync), then continues from the last stored day with a 7-day overlap.",
      "Backlinks: totals only (links, domains, anchors, nofollow share). Individual backlinks are not stored.",
      "Site audit: the latest finished audit's checks become issues; per-page results are not stored.",
    ],
    live: true,
  },
  {
    key: "google_analytics_4",
    name: "Google Analytics 4",
    category: "analytics",
    authType: "oauth2",
    sync: { mode: "polling", defaultIntervalMinutes: 360 },
    rateLimit: { perSecond: 2, burst: 4 },
    requiredScopes: [GOOGLE_SCOPES.analytics],
    resources: ["properties", "ga4_totals", "ga4_channels", "ga4_landing_pages"],
    credentialFields: [],
    docsUrl: "https://developers.google.com/analytics/devguides/reporting/data/v1",
    notes: [
      "Sign in with Google (read-only) or use a service account that has been added as a Viewer on the property. No push notifications exist for report data, so it is polled.",
      "Documented quotas per property: 200,000 tokens per day, 40,000 per hour, 10 concurrent requests; exhaustion returns 429. A sync stops early when the hourly tokens run low and finishes next time.",
      "Metrics: sessions, users, new users, engaged sessions, engagement rate, average session duration, bounce rate, page views and key events, by day; sessions, engaged sessions and key events by channel group and by landing page.",
      "'Key events' is what Google Analytics now calls conversions; 0 means none were recorded (or none are configured).",
      "Recent days are stored as provisional and replaced once Google has finished processing them. Users cannot be summed across days, so only daily users are shown.",
      "GA4 and Search Console count different things (sessions vs. clicks). They are shown side by side and never combined.",
    ],
    live: true,
  },
  {
    key: "google_search_console",
    name: "Google Search Console",
    category: "search",
    authType: "oauth2",
    sync: { mode: "polling", defaultIntervalMinutes: 720 },
    rateLimit: { perSecond: 4, burst: 8 },
    requiredScopes: [GOOGLE_SCOPES.searchConsole],
    resources: ["properties", "gsc_totals", "gsc_devices", "gsc_pages", "gsc_queries"],
    credentialFields: [],
    docsUrl: "https://developers.google.com/webmaster-tools",
    notes: [
      "Sign in with Google (read-only) or use a service account added as a user of the site. No webhooks are documented, so it is polled.",
      "Documented limits: Search Analytics 1,200 queries per minute per site; the API exposes at most 50,000 rows per day per search type, sorted by clicks, and does not guarantee every row.",
      "Only 'final' data is stored (it lags about two to three days). Clicks, impressions, CTR and average position are stored exactly as reported per day, device, page and query.",
      "Totals are most accurate without page or query dimensions, so the daily totals come from a date-only report. Top pages and queries (top 500 per day) are partial lists and will not add up to the totals; anonymised queries are missing.",
      "Over a date range, CTR is clicks divided by impressions and position is weighted by impressions.",
    ],
    live: true,
  },
];

export const getProvider = (key: string) => PROVIDERS.find((p) => p.key === key);
