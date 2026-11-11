# Google Analytics 4 and Search Console (Phase 10)

Adapters: `packages/integrations/src/providers/google`. Storage: `packages/db/src/services/analytics-data.ts` (`analytics_sources`,
append-only `metric_snapshots`). Dashboards: `/analytics` (overview), `/analytics/traffic` (GA4), `/analytics/search` (Search Console).
**Tested with mocked HTTP only.** No real Google credentials were used; the dashboards were exercised with the development mock,
which is labelled in the UI. Items marked "unconfirmed" need a check with a real property.

## Connecting (per client, per product)

Each client connects Google Analytics and Search Console separately (separate permissions, separate failures).

* **Sign in with Google**: OAuth 2.0 authorization-code flow, read-only scopes `analytics.readonly` / `webmasters.readonly`, `access_type=offline` + `prompt=consent`. Needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (`<APP_URL>/api/integrations/google/callback`). Only the refresh token is kept (encrypted); the callback verifies a signed state, a browser cookie and the person, and exchanges the code on the server.
* **Service account**: paste the key file; add the service account's email as a Viewer on the GA4 property / a user of the Search Console site. Only `client_email` and `private_key` are kept, encrypted. Access tokens come from an RS256-signed JWT assertion (one-hour lifetime), cached in memory.
* **Development mock**: shaped like the real responses, runs the real normalisation and storage, every row and property is flagged mock and the dashboards say so.

Tokens and keys never reach the browser. A revoked or expired grant (`invalid_grant`) marks the account for reconnection.

## Property setup and permission validation

The first sync **discovers** properties (GA4 `accountSummaries`, Search Console `sites.list`) as *not selected*. A person selects the ones to track and maps each to one of the
client's websites. Nothing is stored for an unselected property. Search Console sites with permission `siteUnverifiedUser` cannot be selected (Google returns no data for them).
During a sync, a property the account cannot read (403 `PERMISSION_DENIED`) or that no longer exists (404) is recorded as a **problem on that property** (shown beside it, cleared once data arrives) and does not stop other properties.
A disabled API (`accessNotConfigured`) is reported as a platform configuration error.

## What is synced

| Source | Report | Stored |
| --- | --- | --- |
| GA4 | by day | sessions, users, new users, engaged sessions, engagement rate, avg session duration, bounce rate, page views, key events |
| GA4 | by day and channel group | sessions, engaged sessions, key events |
| GA4 | landing pages, one day at a time (top 500 by sessions) | sessions, engaged sessions, key events |
| Search Console | by day | clicks, impressions, CTR, position |
| Search Console | by day and device | same four |
| Search Console | pages and queries, one day at a time (top 500) | same four |

First sync: 90 days. Later syncs continue from the last stored day with a 3-day overlap. Date-grouped reports use 30-day windows. Newest requested day is yesterday.
GA4 "key events" is the current name for conversions; 0 means none were recorded or none are configured.

## Keeping the two products distinct

GA4 sessions and Search Console clicks measure different things and never match. They live in separate metric families (`ga4.*`, `gsc.*`), separate panels, and are never summed. Over a date range:
additive metrics are summed; GA4 engagement rate = engaged sessions ÷ sessions; GA4 duration is weighted by sessions; GA4 **users are not summed across days** (only the daily figure is shown);
Search Console CTR = clicks ÷ impressions and position is **weighted by impressions**. Top pages and queries are the top 500 per day Google reports, so they do not add up to the totals, and anonymised queries are missing.

## History and freshness

`metric_snapshots` is append-only. A reading is added only when it is new, changed, or has become final; identical re-imports add nothing and revised values keep their earlier readings. Dashboards use the latest reading per metric, day and dimension.
GA4's two newest days are stored as **provisional** (`is_final = false`) and replaced when final. Search Console is requested with `dataState = final` only (it lags two to three days). "Data through" advances only from final daily totals, so a failed breakdown never hides a gap.
Each dashboard shows data-through date, age, last sync time, last sync failure and property problems; before the first successful sync it says "Not synced yet" and shows no numbers.

## Quotas and failures

* GA4: documented per-property quotas (200,000 tokens/day, 40,000/hour, 10 concurrent). Reports run `returnPropertyQuota`; the sync **stops before the hourly tokens drop below 2,000** and finishes next time. A 429 naming the daily or hourly bucket becomes `quota_exhausted` (retried later, not hammered).
* Search Console: documented 1,200 queries/minute per site; calls run through the shared rate limiter. Pages and queries are limited to 50,000 rows/day by Google.
* A failure in one report makes the run **partial**; the other reports and properties keep their data. 401 triggers one token refresh and a retry. Errors are fixed safe messages; no token or key appears in them.

## Confirmed vs. unconfirmed

Confirmed from the docs: OAuth endpoints and parameters, service-account JWT flow (RS256, 1 h), `runReport` limit (default 10,000, max 250,000) and `propertyQuota`, GA4 quotas, `accountSummaries` (pageSize max 200), Search Console `searchAnalytics.query` fields (`rowLimit` 1–25,000, `dataState`, final default), `sites.list`, the 50,000 rows/day limit and 2–3 day freshness, and the metric/dimension names used.
Unconfirmed: which dimension/metric combinations a given property accepts (GA4 rejects incompatible ones with 400, reported as an error for that report), the Search Console permission-level values beyond `siteUnverifiedUser`, retention (16 months) and GA4 processing delay (two days is assumed for "provisional"), and whether Google always returns a refresh token for a repeat consent.

## Not built

Search Console `searchAppearance`/country dimensions, GA4 custom dimensions and per-event key-event breakdown, Search Console sitemaps and URL inspection, real-time reports, writing anything to Google.
