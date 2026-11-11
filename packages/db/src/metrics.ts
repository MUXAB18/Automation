/**
 * The metric catalogue. GA4 and Search Console metrics are separate on purpose: sessions are not clicks,
 * and the two sources are never summed or compared as if they counted the same thing.
 */
export type MetricSpec = {
  key: string;
  name: string;
  description: string;
  sourceKind: "ga4" | "search_console";
  unit: "count" | "percent" | "ratio" | "seconds" | "position";
  aggregation: "sum" | "avg" | "last";
};

export const METRIC_CATALOGUE: readonly MetricSpec[] = [
  {
    key: "ga4.sessions",
    name: "Sessions",
    description: "Sessions that began on the site (session_start).",
    sourceKind: "ga4",
    unit: "count",
    aggregation: "sum",
  },
  {
    key: "ga4.total_users",
    name: "Users",
    description: "Distinct users per day. Cannot be summed across days.",
    sourceKind: "ga4",
    unit: "count",
    aggregation: "last",
  },
  {
    key: "ga4.new_users",
    name: "New users",
    description: "Users who interacted for the first time.",
    sourceKind: "ga4",
    unit: "count",
    aggregation: "sum",
  },
  {
    key: "ga4.engaged_sessions",
    name: "Engaged sessions",
    description: "Sessions longer than 10 seconds, with a key event, or with 2+ screen views.",
    sourceKind: "ga4",
    unit: "count",
    aggregation: "sum",
  },
  {
    key: "ga4.engagement_rate",
    name: "Engagement rate",
    description: "Engaged sessions divided by sessions (0 to 1).",
    sourceKind: "ga4",
    unit: "ratio",
    aggregation: "avg",
  },
  {
    key: "ga4.avg_session_duration",
    name: "Average session duration",
    description: "Average session length in seconds.",
    sourceKind: "ga4",
    unit: "seconds",
    aggregation: "avg",
  },
  {
    key: "ga4.bounce_rate",
    name: "Bounce rate",
    description: "Share of sessions that were not engaged (0 to 1).",
    sourceKind: "ga4",
    unit: "ratio",
    aggregation: "avg",
  },
  {
    key: "ga4.page_views",
    name: "Page views",
    description: "Views of web pages or app screens.",
    sourceKind: "ga4",
    unit: "count",
    aggregation: "sum",
  },
  {
    key: "ga4.key_events",
    name: "Key events",
    description: "Events marked as key events (formerly conversions).",
    sourceKind: "ga4",
    unit: "count",
    aggregation: "sum",
  },
  {
    key: "gsc.clicks",
    name: "Search clicks",
    description: "Clicks from Google Search results.",
    sourceKind: "search_console",
    unit: "count",
    aggregation: "sum",
  },
  {
    key: "gsc.impressions",
    name: "Search impressions",
    description: "Times the site appeared in Google Search results.",
    sourceKind: "search_console",
    unit: "count",
    aggregation: "sum",
  },
  {
    key: "gsc.ctr",
    name: "Search click-through rate",
    description: "Clicks divided by impressions (0 to 1).",
    sourceKind: "search_console",
    unit: "ratio",
    aggregation: "avg",
  },
  {
    key: "gsc.position",
    name: "Average search position",
    description:
      "Average position in results; lower is better. Weighted by impressions over a range.",
    sourceKind: "search_console",
    unit: "position",
    aggregation: "avg",
  },
];

export const METRIC_KEYS = new Set(METRIC_CATALOGUE.map((m) => m.key));
