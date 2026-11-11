# SEO & Social Media Automation

Internal platform that manages 15+ clients (businesses) from one dashboard: SEO
automation, social media automation, analytics and automatic reports. First test
client: SARJ Worldwide (sarjworldwide.ca).

## Folder guide

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js dashboard (App Router, Tailwind) |
| `apps/worker` | Node.js background worker (BullMQ + Redis later) |
| `packages/db` | Schema and migrations |
| `packages/integrations` | claude, google-search-console, ga4, meta, linkedin, email |
| `packages/seo` | crawler, audits, keywords, rankings |
| `packages/reports` | Report generation |
| `packages/config` | Shared tsconfig and eslint config |
| `docker` | Compose and Caddy (placeholders) |

See `CLAUDE.md` for the design rules.

## Documentation

| File | What it covers |
| --- | --- |
| [prd.md](prd.md) | Product goals, users, requirements, metrics |
| [design.md](design.md) | UX: information architecture, screens, flows, visual rules |
| [architecture.md](architecture.md) | System design, monorepo, web, worker, tenancy |
| [phases.md](phases.md) | Delivery phases and exit criteria |
| [data-model.md](data-model.md) | Planned database tables and rules |
| [jobs-and-workflows.md](jobs-and-workflows.md) | Queues, schedules, approvals, failure handling |
| [integrations.md](integrations.md) | External services and client rules |
| [security.md](security.md) | Isolation, secrets, access, review checklist |
| [deployment.md](deployment.md) | Docker Compose, VPS, backups, monitoring |
| [conventions.md](conventions.md) | Code, naming, git, testing, definition of done |
| [decisions.md](decisions.md) | Architecture decision records |
| [glossary.md](glossary.md) | Terms |

## Run locally

Requirements: Node 22+, npm, a local PostgreSQL, and Redis (Docker is the easiest).

```bash
npm install
cp .env.example .env            # then fill BETTER_AUTH_SECRET and SEED_ADMIN_PASSWORD
createdb automation && createdb automation_test
docker compose -f docker/docker-compose.dev.yml up -d   # Redis
npm run db:deploy                  # apply migrations
npm run db:seed                    # admin user + SARJ Worldwide
npm run dev                        # web on http://localhost:3000, worker heartbeat
```

Sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from your `.env`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Run web and worker |
| `npm run build` | Build web, typecheck worker |
| `npm run lint` / `npm run typecheck` / `npm run test` | Quality checks (tests need `TEST_DATABASE_URL`) |
| `npm run db:migrate` | Create and apply a migration in development |
| `npm run db:deploy` | Apply existing migrations |
| `npm run db:seed` | Seed the admin user and SARJ Worldwide (idempotent) |

## Authentication

See [docs/auth.md](docs/auth.md) for the sign-in, role and permission model, how to create the first admin, and the development sample users.
