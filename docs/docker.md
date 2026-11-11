# Running with Docker

Three ways to run the project. They share the same database schema (Prisma migrations in `prisma/migrations`) and
the same code; pick the one that suits the moment. All commands run from the repository root.

| Mode | Database | Apps | When |
| --- | --- | --- | --- |
| **Local** | PostgreSQL installed on this machine (`localhost:5432`) | `npm run dev` | Day-to-day development |
| **Docker infrastructure** | PostgreSQL + Redis in containers (`localhost:5433`, `localhost:6379`) | `npm run dev` | Development without installing Postgres/Redis |
| **Full stack** | PostgreSQL, Redis, migrations, web, worker, keyword service in containers | containers | Production-like run, demos, deployment |

Requirements: Docker Desktop (or Docker Engine with the Compose plugin), Node 22, npm 10.

## Full stack

```bash
npm run docker:init    # once: creates .env.docker with generated secrets (git-ignored, never printed)
npm run docker:up      # builds the images and starts everything; migrations run automatically
npm run docker:seed    # first time only: reference data, roles, the admin user, sample data
```

Open <http://localhost:3000> and sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `.env.docker`
(`docker:init` reuses the admin login from your local `.env` when there is one).

| Service | What it is | Port on this machine |
| --- | --- | --- |
| `postgres` | PostgreSQL 17, volume `postgres-data`, creates `automation` and `automation_test` | `127.0.0.1:5433` |
| `redis` | Redis 7 with persistence (BullMQ queues) | internal only |
| `migrate` | One-shot `prisma migrate deploy`; `web` and `worker` wait for it | none |
| `web` | Next.js standalone server, uploads in volume `uploads` | `3000` (`WEB_PORT`) |
| `worker` | BullMQ worker: syncs, publishing, scheduled jobs | none |
| `ml` | Python keyword intent/clustering service (FastAPI, token protected) | internal only |
| `caddy` | Optional HTTPS reverse proxy (`--profile proxy`) | `80`, `443` |

Useful commands: `npm run docker:ps`, `npm run docker:logs`, `npm run docker:down` (keeps data),
`npm run docker:reset` (**deletes** the database and uploads).

Health: `GET /api/health` returns `{"status":"ok"}` only when the web app can reach the database. Every container
has a health check, and start-up is ordered: database healthy, migrations done, then web and worker.

### Configuration

`.env.docker` holds the secrets. Required: `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`
(32 bytes, base64), `ML_SERVICE_TOKEN`, and the `SEED_ADMIN_*` login. `APP_URL` must match the address people use
(default `http://localhost:3000`; set the real `https://` address in production). Optional: `GHL_*`, `GOOGLE_*`
(integrations; without them only the labelled development mocks are available), `WEB_PORT`, `POSTGRES_HOST_PORT`.
Keep the same `ENCRYPTION_KEY` for the life of the data: stored integration credentials cannot be read without it.

### HTTPS

`docker compose --env-file .env.docker -f docker/docker-compose.yml --profile proxy up -d`, with
`SITE_ADDRESS=app.example.com` and `APP_URL=https://app.example.com` in `.env.docker`. Caddy obtains and renews the certificate.

## Local database next to Docker

A PostgreSQL installed on this machine keeps working on port 5432. The Docker database listens on **5433** so the two never
collide, and each has its own data. To use the Docker database from `npm run dev`, point `.env` at it:

```
DATABASE_URL=postgresql://automation:<POSTGRES_PASSWORD from .env.docker>@localhost:5433/automation
TEST_DATABASE_URL=postgresql://automation:<same password>@localhost:5433/automation_test
REDIS_URL=redis://localhost:6379
```

To use the **local** Postgres from the Docker containers instead, leave `postgres` out and override `DATABASE_URL` with
`host.docker.internal` (for example `postgresql://user:pass@host.docker.internal:5432/automation`). Apply migrations to
whichever database you use with `npm run db:deploy` (host) or the `migrate` service (containers).

## Docker infrastructure only (apps on your machine)

```bash
npm run docker:dev        # PostgreSQL on 127.0.0.1:5433 and Redis on 127.0.0.1:6379 (user/password: automation)
npm run db:deploy && npm run db:seed
npm run dev               # web and worker on this machine
npm run docker:dev:ml     # optional: the keyword service on 127.0.0.1:8001
npm run docker:dev:down
```

Do not run this together with the full stack: both publish port 5433 (change `POSTGRES_HOST_PORT` to run both).

## Images

* `docker/Dockerfile.web`: multi-stage build, Next.js `output: "standalone"` (set by `NEXT_STANDALONE=1`), non-root user,
  no secrets needed at build time (everything is read when the server starts).
* `docker/Dockerfile.app`: worker and tooling (migrate, seed). Runs TypeScript with `tsx`; dev dependencies are installed on purpose.
* `services/ml/Dockerfile`: trains the bootstrap model at build time; requires `ML_SERVICE_TOKEN` at run time.

## Troubleshooting

* *"run npm run docker:init"* when starting: `.env.docker` is missing or incomplete.
* *Port already in use*: change `WEB_PORT` / `POSTGRES_HOST_PORT` in `.env.docker`.
* *Login fails after changing `APP_URL`*: sign-in only works from the address in `APP_URL`.
* *Fresh start*: `npm run docker:reset`, then `npm run docker:up` and `npm run docker:seed`.
