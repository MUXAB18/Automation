# SE Ranking integration (Phase 9)

Adapter: `packages/integrations/src/providers/seranking`. Persistence: `packages/db/src/services/seranking-data.ts`.
Dashboards: `/seo/projects/[id]`. **Tested against mocked HTTP responses only. No real SE Ranking key was used and no live
result has been observed.** Items marked "unconfirmed" must be checked with a real key before production use.

## Access and plan

SE Ranking's Project API says "what you can call depends on your plan, not on the key", and it does not name which plan
includes which operation. Project API calls use subscription limits; the Data API draws on a credit balance (this integration
uses only Project API methods and the free Website Audit read methods). Because the plan cannot be known in advance, a
feature the account cannot use (HTTP 403 "No access" / "Access denied") is recorded as **unsupported** for that sync, with the
reason, and the rest of the sync continues. A 403 "No token" / "Incorrect token" is a bad key and asks for reconnection.

## Confirmed from the official documentation (seranking.com/api)

| Topic | Confirmed |
| --- | --- |
| Base URL / auth | `https://api.seranking.com`, header `Authorization: Token <key>` |
| Rate limit | Any method at most 5 times per second; repeated excess blocks the key for 10 minutes. The adapter spaces its own calls 250 ms apart |
| Errors | 400, 403 (`No token`, `Incorrect token`, `No access`, `Access denied`), 404, 429, 500 |
| Projects | `GET /v1/project-management/sites` (`id`, `title`, `name`, `group_id`, `is_active`, `keyword_count`, ...) |
| Engines | `GET /v1/project-management/sites/search-engines?site_id` (`site_engine_id`, `search_engine_id`, `region_name`, `lang_code`, ...) |
| Keywords | `GET /v1/project-management/keywords?site_id&site_engine_id` (`id`, `name`, `link`, `tags`, ...) |
| Rankings | `GET /v1/project-management/sites/positions?site_id&site_engine_id&date_from&date_to&with_landing_pages` -> per engine, keywords with `positions[{date,pos,change}]`, `volume`, `landing_pages[{url,date}]` |
| Summary | `GET /v1/project-management/sites/summary?site_id` (`top5/10/30`, `visibility`, `visibility_percent`, `da`, `index_google`, ...) |
| Competitors | `GET /v1/project-management/competitors?site_id` (`id`, `name`, `url`, `domain_trust`) |
| Backlinks | `GET /v1/project-management/backlinks/stats?site_id` (`total`, `anchors`, `ip`, `domains`, `dofollow`, `nofollow`, `limit`) |
| Site audit | `GET /v1/site-audit/audits` (`limit`, `offset`; `total`, `items[{id, site_id, last_update, status, stats{score,errors,warnings,notices,crawled}}]`), `/audits/report?audit_id` (`score_percent`, `sections[].props[{code,status,name,value}]`), `/audits/issue-pages?audit_id&code&limit&offset` (`urls[]`). Read methods cost no credits |

## Not confirmed (handled defensively)

* Pagination: none is documented for sites, engines, keywords, positions, summary or competitors, so they are read in one call each. Positions are read in 30-day windows because no maximum range is documented.
* The meaning of `pos = 0` is not documented. A non-positive position is stored as "not ranking" (null), never as position 0.
* There is no documented account endpoint, so one SE Ranking account per client is assumed (`external_account_id = seranking`).
* Whether a project can have more than one device per engine is not documented. One engine is tracked per linked project and the device is stored as `desktop`.
* The country of an engine is not given as an ISO code. Keywords take the country and language of the linked platform SEO project, and the engine's region name is shown beside it so a mismatch is visible.
* Rate-limit headers are not documented for SE Ranking; a 429 backs off 15 seconds.

## How data maps to the existing models (migration `20261106100000_phase9_seranking`)

| SE Ranking | Platform |
| --- | --- |
| Project (site) | `provider_seo_projects` (discovered). A person links it to a `seo_projects` row and chooses the engine; nothing is synced until then and the mapping is never guessed |
| Keyword | `keywords` with `external_source = se_ranking`, `external_id`, search volume. A keyword added by hand with the same term is **adopted**, not duplicated |
| Position per day | `keyword_rank_snapshots` (`source = se_ranking`), **append-only**: a row is added only when the day is new or the reading was revised; identical re-imports add nothing |
| Project summary | `provider_seo_projects.summary` exactly as reported, with its time |
| Audit | `site_audits` (provider id, health score, counts, source in `summary`) |
| Audit checks | `seo_issues` with fingerprint `se_ranking:<code>` (one per check per project): created once, updated on re-import, **reopened** if a fixed one returns, **fixed** when the latest finished audit no longer reports it (never from an empty report). Human decisions (acknowledged, in progress, ignored) are kept. Every change writes `seo_issue_history` |
| Competitor | `competitors` (provider id, domain trust in `provider_data`); adopted by domain if it already exists |
| Backlink totals | `backlink_snapshots` (`source = se_ranking`), one per sync run |

Rankings continue from the last stored day (`rankings_through`) with a 7-day overlap; the first sync reads 90 days.
Each sync records its provider ids, `synced_at`, source (`live`) and safe errors in `sync_runs` / `sync_errors`.

## Dashboard

`/seo/projects/[id]`: overview (headline numbers, 90-day average-position and top-10 charts, provider summary), keywords (latest position, change, trend, volume, ranking page), site audit, issues (filter by severity/status, example pages), competitors and backlinks.
Every number is computed from stored rows. A keyword with no reading shows "No reading", a project without a link shows "Not connected", and the header shows the last successful sync (or that the last one failed / was partial / is a mock).

## Not built

Individual backlinks and new/lost links, per-page audit results, competitor rankings, several engines or devices per project, Data API keyword research (credit based), creating audits or projects in SE Ranking.
