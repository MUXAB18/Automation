# Production deployment

How to run the platform for real clients. For local development see `docs/docker.md`; for day-two
operations (logs, monitoring, backups, incidents) see `docs/operations.md`; for what is and is not verified
see `docs/production-readiness.md`.

## Topology

| Service | Image / command | Public? | Notes |
| --- | --- | --- | --- |
| `caddy` | `caddy:2-alpine` (profile `proxy`) | 80/443 | Only public entry; automatic HTTPS |
| `web` | `docker/Dockerfile.web` | localhost only | Next.js. Never runs long jobs |
| `worker` | `docker/Dockerfile.app` | no | BullMQ loops: sync, publish, reports, AI, automation, heartbeat. No browser or user session needed |
| `migrate` | `docker/Dockerfile.app`, `prisma migrate deploy` | no | One-shot; web and worker wait for it |
| `postgres` | `postgres:17-alpine` | no | Use a managed Postgres in production if you can |
| `redis` | `redis:7-alpine` | no | Queue storage (AOF on) |
| `ml` | `services/ml` | no | Keyword intent/clustering, bearer-token protected |
| `n8n` | profile `n8n` | localhost | Optional; see "n8n" in `docs/operations.md` |

The worker and every scheduled job run from the worker process. Nothing depends on a signed-in browser:
jobs read stored (encrypted) credentials and loop over all active clients.

## Environment variables

Validated at startup with Zod (`packages/config/src/env.ts`); a bad value stops the process with a list of
every problem. Empty values count as unset.

### Required

| Variable | Used by | Notes |
| --- | --- | --- |
| `DATABASE_URL` | web, worker, migrate | `postgresql://user:pass@host:5432/db`. Add `?sslmode=require` for managed databases |
| `REDIS_URL` | worker | `redis://host:6379` (`rediss://` for TLS) |
| `APP_URL` | web | Public `https://` URL. Used in invitation/reset links and OAuth redirects |
| `BETTER_AUTH_SECRET` | web | 32+ chars. Signs sessions and OAuth state. Rotating it signs everyone out |
| `ENCRYPTION_KEY` | web, worker | 32 bytes (64 hex or base64). Encrypts every stored third-party token. **Losing it makes connected accounts unrecoverable** (clients must reconnect) |
| `MAIL_TRANSPORT` | web, worker | Must be `resend` in production (`log` is refused) |
| `EMAIL_API_KEY`, `EMAIL_FROM` | web, worker | Resend key and a verified sender |
| `ML_SERVICE_TOKEN` | ml, web, worker | 24+ chars, shared secret between app and ML service |

### Optional

| Variable | Default | Notes |
| --- | --- | --- |
| `ENCRYPTION_KEY_PREVIOUS` | none | Comma-separated retired keys, decrypt-only, for rotation |
| `GHL_CLIENT_ID`, `GHL_CLIENT_SECRET`, `GHL_REDIRECT_URI` | none | Set all three or none. Without them GoHighLevel only works as the development mock |
| `GHL_PUBLISHING_ENABLED` | `0` | Keep `0` until posting is verified in a sandbox location |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | none | All three or none. Service-account connections need none |
| `AI_PROVIDER` | `mock` | `anthropic` or `openai_compatible` for real output; needs `AI_MODEL` and `AI_API_KEY` (or `AI_BASE_URL`) |
| `AI_DEFAULT_MONTHLY_REQUESTS`, `AI_DEFAULT_MONTHLY_COST_USD`, `AI_PER_USER_HOURLY` | 200 / 0 / 30 | Spend and abuse caps |
| `SYNC_POLL_INTERVAL_MS`, `REPORT_POLL_INTERVAL_MS`, `AUTOMATION_POLL_INTERVAL_MS`, `HEARTBEAT_INTERVAL_MS` | 15 s / 60 s / 60 s / 5 min | Worker polling |
| `WORKER_HEALTH_PORT` | `8081` | Worker `GET /health`; `0` disables |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `UPLOAD_DIR` | `/data/uploads` in Docker | Task attachments. **Must be on a persistent volume** and included in backups |
| `WEB_PORT`, `SITE_ADDRESS` | 3000, none | Compose only |

Never set `ML_ALLOW_NO_AUTH`, `SEED_DEV_USER_PASSWORD` or `SEED_SAMPLE_DATA` in production.

## Secure credential setup

1. Generate secrets on the server, not on a laptop that syncs to cloud storage:
   `openssl rand -base64 32` (`BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`), `openssl rand -hex 24`
   (`ML_SERVICE_TOKEN`, `POSTGRES_PASSWORD`). `npm run docker:init` does this into `.env.docker` (mode 600).
2. Copy that file to `.env.production`, set `APP_URL`, `SITE_ADDRESS`, mail and any provider credentials.
   Keep it out of git (already ignored) and readable only by the deploy user (`chmod 600`).
3. Store `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` in a password manager or secret store **as well**; they
   are the two values you cannot regenerate.
4. Provider credentials (GoHighLevel/Google OAuth apps, SE Ranking keys, AI key) are platform secrets in
   the environment; per-client tokens are connected through the UI and stored AES-256-GCM encrypted,
   bound to the client they belong to.
5. Create the first admin with `npm run docker:seed` (production mode skips sample data), then change the
   seeded password and remove `SEED_ADMIN_PASSWORD` from the env file.
6. Rotate `ENCRYPTION_KEY`: set the new key, move the old one to `ENCRYPTION_KEY_PREVIOUS`, restart web and
   worker. Old ciphertext still decrypts and is flagged as needing rotation (`needsRotation` in the
   cipher). Whether a bulk re-encryption job exists is not covered here: keep the old key in
   `ENCRYPTION_KEY_PREVIOUS` until you have confirmed every account has been re-saved.

## First deployment

```bash
git clone <repo> && cd automation
npm run docker:init                      # generates .env.docker
cp .env.docker .env.production && chmod 600 .env.production
$EDITOR .env.production                  # APP_URL, SITE_ADDRESS, MAIL_*, providers
docker compose --env-file .env.production \
  -f docker/docker-compose.yml -f docker/docker-compose.prod.yml \
  --profile proxy up -d --build
docker compose --env-file .env.production -f docker/docker-compose.yml \
  -f docker/docker-compose.prod.yml --profile seed run --rm seed   # first time only
curl -fsS https://$SITE_ADDRESS/api/health
```

Point DNS at the host before the first start so Caddy can obtain a certificate.

## Database migrations

- Migrations are in `prisma/migrations` and are applied by the `migrate` service with
  `prisma migrate deploy` on every `up`. It only applies pending, reviewed migrations; it never resets,
  drops or regenerates anything.
- **Never run `prisma migrate dev`, `migrate reset` or `db push` against a production database.** `npm run db:migrate`
  is the development command. Tests refuse to run when `TEST_DATABASE_URL` equals `DATABASE_URL`.
- Deploy procedure for a release with a migration: take a backup (`docs/operations.md`), deploy, confirm
  `migrate` exited 0 (`docker compose ps -a migrate`), then check `/api/health`.
- Migrations are forward-only. To undo one, restore the backup taken before the deploy, or write a new
  corrective migration.

## CI/CD

`.github/workflows/ci.yml` runs on every pull request and push to `main`: `prisma validate`, migrations
against a throwaway Postgres, typecheck, lint, unit and database integration tests, production build, an HTTP
smoke test of the built server (`scripts/smoke.mjs`), `npm audit` for production dependencies, the ML
service tests and both Docker image builds. It deliberately has **no deploy step and no production
credentials**. Deploy by pulling `main` on the server and running the command above, after CI is green.
Add an automated deploy only once you have a staging environment to point it at.
