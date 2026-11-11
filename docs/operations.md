# Operations

## Health checks

| Endpoint | Meaning | Used by |
| --- | --- | --- |
| web `GET /api/health` | 200 `{"status":"ok"}` when Postgres answers within 3 s, else 503. Public, uncached, no detail | Docker `HEALTHCHECK`, Caddy/uptime monitor |
| worker `GET :8081/health` | 200 only when Postgres **and** Redis answer **and** every polling loop has ticked recently. Body lists per-loop age; 503 `error` = dependency down, 503 `degraded` = a loop stopped ticking | Compose `healthcheck` on `worker` |

The worker port is not published. Probe it from inside the network, or add it to your orchestrator.
Point an external uptime monitor at `https://<domain>/api/health` and alert on two consecutive failures.

## Logs

All services write **JSON lines** to stdout/stderr (`packages/config/src/logger.ts`):

```json
{"service":"worker","queue":"sync","result":{"executed":2},"time":"…","level":"info","msg":"tick did work"}
```

- Containers rotate logs (10 MB x 5). Ship them with your platform's driver (Loki, CloudWatch, Datadog…)
  or `docker compose logs -f --tail=200 worker | jq`.
- Secrets are redacted before writing: values under keys like `password`, `token`, `authorization`,
  `apiKey`, `credential`, `signature`; bearer tokens, URL passwords, stored-token ciphertext and
  `?code=`/`?token=` query values inside strings. Errors are logged as name + code + scrubbed message,
  never the raw object. Add new logging through `logger`, not `console`.
- Per-client state (sync runs, publish jobs, report deliveries) is also in the database tables the
  dashboard reads; the audit log records every change to client data.

## What to monitor and alert on

| Signal | Source | Alert when |
| --- | --- | --- |
| Web up | `/api/health` | 2 consecutive failures |
| Worker healthy | container health status | `unhealthy` for > 5 min |
| Errors | log lines with `"level":"error"` | rate above baseline; any `unhandled rejection` / `uncaught exception` (the worker exits and Docker restarts it) |
| Sync failing | `sync_runs` / dashboard "needs reconnect" | an account in `needs_reauth` for > 1 day |
| Publishing | `publishing_jobs` in `needs_review` ("outcome unknown") | any (a person must resolve them: the app never retries an unclear post) |
| Reports | report deliveries `failed` | any, after retries |
| Disk | Postgres volume, `uploads` volume, `./backups` | > 80% |
| Backups | newest file in `./backups` | older than 26 h |

## Backups and restore

What to back up: **(1)** the Postgres database, **(2)** the `uploads` volume (task attachments), **(3)** your
`.env.production`, especially `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET`. A database backup without
`ENCRYPTION_KEY` restores everything except the ability to use stored provider tokens.
Redis holds only queue state that the worker rebuilds; it does not need backing up.

### Back up

```bash
docker compose --env-file .env.production -f docker/docker-compose.yml \
  -f docker/docker-compose.prod.yml --profile backup run --rm backup
```

Writes `backups/automation-<UTC timestamp>.dump` (pg_dump custom format), validates it with `pg_restore --list`,
and deletes dumps older than `BACKUP_RETENTION_DAYS` (default 14). Schedule it from the host, e.g.
`15 2 * * *  cd /srv/automation && docker compose … run --rm backup`. Copy `backups/` off the host (object
storage, another region): a backup on the same disk is not a backup. For the uploads volume:
`docker run --rm -v automation_uploads:/data -v $PWD/backups:/out alpine tar czf /out/uploads-$(date -u +%F).tgz -C /data .`
With a managed Postgres, also enable its point-in-time recovery.

### Restore (always into a new database first)

```bash
# 1. Create an empty database next to the live one. Nothing is overwritten.
docker compose exec postgres createdb -U automation automation_restore
# 2. Load the dump.
docker compose exec -T postgres pg_restore -U automation -d automation_restore --no-owner < backups/automation-<stamp>.dump
# 3. Inspect it (row counts, newest records).
docker compose exec postgres psql -U automation -d automation_restore -c 'select count(*) from clients;'
```

To cut over, stop `web` and `worker`, take one more backup of the live database, then point
`DATABASE_URL` at `automation_restore` (or rename databases with `ALTER DATABASE`), start the services and
check `/api/health`. **Dropping or overwriting the live database is a manual, deliberate step that needs a
person's explicit go-ahead; no script in this repository does it.** Rehearse a restore at least once before
go-live and after any major schema change, and record how long it took.

## Runbooks

- **Worker unhealthy / degraded**: `docker compose logs --tail=200 worker`; `degraded` names the stale loop
  in the health body. A restart is safe: runs left "running" are failed and re-queued by each dispatcher's
  reaper; publishing jobs left mid-publish are re-queued only if the request was never sent; if it may have been sent they move to `needs_review` and are never reposted automatically.
- **Account stuck on "needs reconnect"**: credentials were rejected/expired/revoked. A client admin reconnects
  it from Integrations. Sync resumes from the stored day.
- **Provider rate limited / down**: syncs back off using the provider's retry hint and retry up to the attempt
  limit; nothing to do unless it persists beyond a day.
- **Held publish job ("outcome unknown")**: check the client's social account for the post, then mark it
  posted or re-queue it from the content page.
- **Report delivery failed**: the report stays generated; fix the recipient or mail credentials and retry
  from the report page.
- **Bad deploy**: redeploy the previous git revision. If it included a migration, restore from the backup taken
  before the deploy (migrations are forward-only).
- **Suspected credential leak**: rotate `BETTER_AUTH_SECRET` (signs everyone out), the affected provider keys,
  and `ENCRYPTION_KEY` (with the old key in `ENCRYPTION_KEY_PREVIOUS`); ask clients to reconnect revoked accounts.

## n8n

n8n is available as an optional compose profile (`--profile n8n`, pinned via `N8N_VERSION`, own `n8n` database,
bound to localhost, put behind Caddy for HTTPS). It runs on its own schedule triggers and never needs a
browser session. **Current state: the platform does not call n8n and exposes no authenticated inbound API for
it**, so there are no ready-made workflows. Scheduling, retries and delivery already run in the BullMQ
worker (project rule 4); adopt n8n only for glue that is genuinely outside the app, and when you do, add an
inbound endpoint that verifies an HMAC signature and deduplicates on an event id (the `webhook_events` table
and its `(integration_id, external_event_id)` uniqueness are already in the schema for this).

## Rate limiting

- Sign-in and password-reset requests: per email and per IP, stored in the audit log (works across instances,
  survives restarts).
- Report PDF export and OAuth starts: 20 per person per 10 minutes (HTTP 429, `Retry-After`).
- AI generation: per-user hourly cap and per-client monthly caps (`AI_*`).
- Provider calls: each adapter spaces calls to the provider's documented limit and honours `Retry-After`.
- Everything else relies on authentication. Add connection-level limiting at the proxy (Caddy rate-limit
  module or your cloud WAF) if the site is exposed to the open internet.
