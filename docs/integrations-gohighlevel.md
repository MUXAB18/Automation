# GoHighLevel integration (Phase 8)

Adapter: `packages/integrations/src/providers/gohighlevel`. It runs on the shared framework
([integrations-framework.md](integrations-framework.md)). **It has only been tested against mocked HTTP responses.
No real GoHighLevel credentials were used and no live result has been observed.** Everything below marked
"unconfirmed" must be checked against a real sandbox location before production use.

## Setup

1. Register a marketplace app in GoHighLevel; set its redirect URL to `<APP_URL>/api/integrations/gohighlevel/callback`.
2. Set `GHL_CLIENT_ID`, `GHL_CLIENT_SECRET`, `GHL_REDIRECT_URI` (all three or none) for the web app **and** the worker.
3. Connect a location from Integrations > GoHighLevel. Without the variables only the labelled development mock is available.
4. Posting stays off until `GHL_PUBLISHING_ENABLED=1` (see "Publishing").

## What was confirmed from the official documentation

Sources: `github.com/GoHighLevel/highlevel-api-docs` (OpenAPI specs and OAuth docs) and `marketplace.gohighlevel.com/docs`.

| Topic | Confirmed |
| --- | --- |
| Base URL / token URL | `https://services.leadconnectorhq.com`, `POST /oauth/token` |
| Authorize URL | `https://marketplace.gohighlevel.com/v2/oauth/chooselocation` with `response_type`, `redirect_uri`, `client_id`, `scope` (space separated) |
| Grants | `authorization_code` (JSON body in the docs) and `refresh_token` (form body); fields `client_id`, `client_secret`, `grant_type`, `code`/`refresh_token`, `user_type`, `redirect_uri` |
| Tokens | Access token about 24 h (`expires_in` 86399/86400); refresh token valid one year if unused and **rotates** on every refresh |
| Header | `Version` is required: `2021-07-28` for contacts, opportunities, campaigns, workflows, locations, social; `2021-04-15` for conversations |
| Rate limits | 100 requests / 10 s burst and 200,000 / day per app and location; headers `X-RateLimit-Limit-Daily`, `-Daily-Remaining`, `-Interval-Milliseconds`, `-Max`, `-Remaining` |
| Scopes | `contacts.readonly`, `opportunities.readonly`, `conversations.readonly`, `campaigns.readonly`, `workflows.readonly`, `locations.readonly`, `socialplanner/account.readonly`, `socialplanner/post.readonly`, `socialplanner/post.write` (all "Sub-Account") |
| Endpoints | `GET /contacts/` (limit max 100, `startAfter`, `startAfterId`; **marked deprecated**), `GET /opportunities/search` (`location_id`, `startAfter`, `startAfterId`, limit up to 100; meta has `startAfter`, `startAfterId`, `nextPageUrl`), `GET /opportunities/pipelines`, `GET /conversations/search`, `GET /campaigns/`, `GET /workflows/`, `GET /locations/{id}`, `GET /social-media-posting/{loc}/accounts`, `POST /social-media-posting/{loc}/posts/list` (`skip`, `limit`, `fromDate`, `toDate`, `includeUsers` required), `POST /social-media-posting/{loc}/posts` (`type`, `accountIds`, `userId` required), `POST /social-media-posting/statistics?locationId` (`profileIds`; last 7 days vs previous 7) |
| Post statuses | `draft`, `in_progress`, `failed`, `published`, `scheduled`, `in_review`, `notification_sent`, `deleted` |
| Webhooks | Exist; signed with `x-wh-signature` (RSA/SHA-256). **Not implemented**: data is polled |

## What was NOT confirmed (so it is handled defensively)

* Contacts list response `meta` fields (response schema truncated in the spec text read). Paging uses `meta.startAfterId/startAfter` and **fails with `invalid_response` rather than guessing** if a full page arrives without them.
* `GET /opportunities/pipelines` response shape (only the request is documented in what was read): parsed tolerantly.
* Conversations: the documented search item has no cursor value. Only the latest 20 are read unless the API supplies `lastMessageDate`.
* The success response of "create post" (`results.post._id` is inferred from schema names). A success without an id is treated as **outcome unknown**.
* Whether `state` is echoed back by the consent flow (assumed, standard OAuth). The callback **fails closed** if it is not.
* Whether the token endpoint accepts `user_type: Location` for a location-level install (the docs only show `Company`). Agency-level (`Company`) tokens are rejected with a clear message.
* Per-post analytics, campaign/workflow performance: no endpoint was found, so they are shown as unsupported, never estimated.

## Data model (migration `20261105100000_phase8_gohighlevel`)

`crm_contacts`, `crm_pipelines`, `crm_opportunities`, `crm_conversations` (metadata only), `crm_automations` (campaign/workflow),
`provider_social_accounts`, `provider_social_posts`, `provider_social_stats` (append-only). All carry `agency_id`, `client_id`,
`integration_account_id` with composite foreign keys and are unique on `(integration_account_id, external_id)`, so repeating a sync
updates rows and never duplicates them. `publishing_jobs` gained `target_account_ids`, `request_sent_at` and the `needs_review` status;
`sync_runs.summary` (migration `20261105120000`) records source (`live`/`mock`) and which features were unsupported.

Privacy: only fields the platform uses are stored; message text is never stored.

## Sync behaviour

Resources: pipelines, contacts, opportunities, conversations, campaigns, workflows, social accounts, social posts (last 90 days), social statistics.
A resource whose scope was not granted is **skipped and reported** (Features panel), not attempted. Token refresh happens before expiry or after a 401,
and the rotated token is stored before it is used. 429 responses wait for the reported interval (or fail with a retry hint if it is long); a daily-limit 429 is
`quota_exhausted`. One failing resource makes the run `partial`; an auth failure stops it and asks for reconnection.

## Publishing

Off by default (`GHL_PUBLISHING_ENABLED`) because creating a post was never exercised against a real account.
Rules: needs `content.publish`; an **approval of exactly the current content version** (also a database trigger); a non-mock active account with the
write scope; destinations must be synced, non-expired social accounts. One job per (content version, account), enforced by a unique index, so a version cannot be queued twice.
The worker stamps `request_sent_at` **before** calling GoHighLevel. GoHighLevel documents no idempotency key, so any unclear result after sending
(5xx, timeout, network, a success without an id, a non-published status) becomes `needs_review` and is **never retried automatically**; a person checks the planner and records
"posted" (with the post id) or "not posted" (which allows a retry). Only clear refusals are retried (rate limits, re-queued with a delay) or failed.
A withdrawn approval fails queued jobs instead of posting. Mock accounts can never publish.

## Not built (shown as unsupported in the UI or documented)

Webhook ingestion, incremental contact sync, message bodies, scheduling posts on GoHighLevel's side (our worker schedules), per-post performance, agency-level installs.
