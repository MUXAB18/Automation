# Deployment

Target: one Hostinger VPS, Docker Compose, Caddy for HTTPS.

## Services

| Service | Image / build | Notes |
| --- | --- | --- |
| web | build `apps/web` | Next.js standalone output; port 3000 internal |
| worker | build `apps/worker` | No public port |
| postgres | postgres:16 | Volume for data; internal network only |
| redis | redis:7 | Password, persistence (AOF); internal only |
| caddy | caddy:2 | Ports 80/443; reverse proxy to web; automatic TLS |

Files live in `docker/` (`docker-compose.yml`, `Caddyfile`). Currently placeholders.

## Environments

- **Local:** `npm run dev`; Postgres and Redis via a dev compose file or local installs.
- **Production:** `docker compose up -d` on the VPS with a production `.env`.

## Environment variables

See `.env.example`: `DATABASE_URL`, `REDIS_URL`, `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `EMAIL_API_KEY`, `APP_URL`, `ENCRYPTION_KEY`. More are added as features land.
A Zod validator fails startup if any required variable is missing.

## Release procedure (planned)

1. Merge to main; CI runs lint, typecheck, tests.
2. SSH to VPS, `git pull`, `docker compose build`.
3. Run migrations (one-off command), then `docker compose up -d`.
4. Check `/api/health` and worker heartbeat.
5. Roll back by redeploying the previous image tag; migrations must be backward compatible.

## Backups

- Nightly `pg_dump`, encrypted, copied off the VPS.
- Retain 14 daily + 8 weekly. Test a restore every quarter.
- Redis holds only queue state; it can be rebuilt (schedulers re-register at startup).

## Monitoring

- Health route and worker heartbeat checked by an external uptime monitor.
- Alerts for failed jobs and missed reports.
- Disk, memory and container restarts watched; log rotation enabled.

## Capacity

Start with 2 vCPU / 4 GB RAM. Crawls and PDF generation are the heavy tasks: limit their concurrency.

> Production deployment, operations and the readiness checklist now live in `docs/production.md`, `docs/operations.md` and `docs/production-readiness.md`.
