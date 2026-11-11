# Integration framework (Phase 7)

Shared infrastructure for connecting third-party providers per client. **No live provider adapter ships
yet.** GoHighLevel, SE Ranking, Google Analytics 4 and Google Search Console are registered with verified
facts, and each can be connected only as a **development mock** (clearly labelled, never shown as live data).

## Pieces

| Where | What |
| --- | --- |
| `packages/integrations/src/framework` | Provider contract (`ProviderAdapter`), error mapping, rate limiter, retry, `runSync` pipeline, registry, mock adapter, provider descriptors |
| `packages/db/src/services/integrations.ts` | Accounts, encrypted credentials, connection-test results, sync queue, retry, worker-side claim/finish, scheduler |
| `packages/db/src/services/integration-health.ts` | Provider health derived from recent runs |
| `apps/worker/src/jobs/sync-dispatch.ts` | Polls for queued runs and due accounts, runs them through the pipeline |
| `apps/web/.../integrations` | Overview, setup (connect / reconnect), account detail with history and retry |

## Adapter contract

`testConnection`, `fetchPage` (cursor pagination), `normalize`, `mapError`, plus a descriptor with auth type,
required scopes, sync mode (polling / webhook), rate limit and credential fields. Adapters are stateless:
decrypted credentials are passed per call. `runSync` does: rate limit -> fetch with retry -> normalize ->
sink. Provider errors never throw out of it; they become safe `SyncError` rows.

* Errors use one vocabulary (`auth_failed`, `insufficient_scope`, `rate_limited`, `quota_exhausted`, `provider_unavailable`, `timeout`, ...). Only fixed, safe messages are stored; raw provider bodies never are.
* Retry: exponential backoff with jitter on retryable codes; a provider `Retry-After` wins. Auth failures are not retried and mark the account `needs_reauth`.
* Rate limiting: token bucket per `provider:account`; a 429 with `Retry-After` penalises the bucket.
* Persistence: the `SyncSink` interface. The worker's sink currently discards and reports `rows_written = 0`, because provider-specific tables do not exist yet. Row counts are never inflated.

## Secrets

* Credentials are AES-256-GCM encrypted (`ENCRYPTION_KEY`, rotation via `ENCRYPTION_KEY_PREVIOUS`) with the client and provider bound as authenticated data.
* Decrypted only inside `withAccountCredentials` (web, per action) and `loadRunForExecution` (worker). Views are built from explicit field lists; a test asserts neither plaintext nor ciphertext appears in any view.
* The UI shows only a masked hint (last four characters of a long secret). Disconnecting overwrites the stored value.
* The connection is tested before anything is saved, and the actor is authorised before the provider is contacted.

## Sync lifecycle

`queued` (web or scheduler) -> `running` (worker claims with `FOR UPDATE SKIP LOCKED`) -> `succeeded | partial | failed`.
A partial unique index allows one queued/running run per account. Runs stuck `running` for 30 minutes are failed.
Every attempt records start, finish, status, attempt number, trigger and safe errors. Retrying creates a new
attempt (`trigger = retry`) and is allowed only on the latest failed, partial or cancelled run.
Scheduled and automatic retries only apply to **live** accounts; mock accounts sync on request only.

## Permissions

`integration.view` (status, history, health), `integration.sync` (test, sync now, retry), `integration.manage`
(connect, reconnect, replace credentials, disconnect). Scopes: each descriptor lists required scopes; the account
stores what was granted, and a missing scope blocks the connection test and shows a reconnect prompt.

## Provider facts (checked against official docs)

| Provider | Auth | Sync | Documented limits |
| --- | --- | --- | --- |
| GoHighLevel | OAuth 2.0 + refresh tokens | Polling + webhooks (after app install) | 100 requests / 10 s burst, 200,000 / day, per app and location |
| SE Ranking | API key (`Authorization: Token <key>`) | Polling (no webhooks documented) | Data API 10 req/s per key, Project API 5 req/s, trial 1 req/s |
| Google Analytics 4 | Google OAuth | Polling | Per property: 200,000 tokens/day, 40,000/hour, 10 concurrent; exhaustion = 429 |
| Google Search Console | Google OAuth | Polling | Search Analytics 1,200 queries/min per site and per user; other resources 20/s per user |

Not confirmed from the pages checked, so not assumed: GoHighLevel scopes, Search Console pagination details and
data freshness, GA4 pagination details. Verify these before writing each live adapter. The Google OAuth scope
names (`analytics.readonly`, `webmasters.readonly`) are the standard read-only scopes and are still to be confirmed
against the live adapter's docs.

## Adding a live adapter

Implement `ProviderAdapter` with `isMock: false`, set `live: true` on its descriptor, call
`defaultRegistry.registerLive(adapter)` in the web and worker entry points, add provider tables and a `SyncSink`
that writes into them, and add contract tests with mocked HTTP.

## Database

The Phase 7 migration is `prisma/migrations/20261104100000_phase7_integrations`: it adds the `crm` category,
a partial unique index (one queued/running sync per account) and length checks on `sync_errors`.
