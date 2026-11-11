# Architecture

How the system is built. Product intent is in `prd.md`; UX is in `design.md`.

## 1. Overview

```
            +-----------+       +----------------+
 Browser -> |  Caddy    | ----> |  apps/web      |  Next.js (UI + light API)
            |  (HTTPS)  |       |  reads/writes  |
            +-----------+       +-------+--------+
                                        |  enqueue jobs / read results
                                        v
                  +---------+   +---------------+   +--------------+
                  | Postgres| <-| apps/worker   |-> | Redis/BullMQ |
                  +---------+   | queues + cron |   +--------------+
                                +-------+-------+
                                        | uses
                                        v
                       packages/{integrations,seo,reports,db}
                                        |
                  Claude API, Google (GSC, GA4), Meta, LinkedIn, email
```

One codebase, one database, one worker. Customers are rows, not deployments.

## 2. Monorepo layout

| Path | Responsibility |
| --- | --- |
| `apps/web` | Next.js App Router dashboard, auth, server actions, health route |
| `apps/worker` | BullMQ workers, scheduler, job_runs logging |
| `packages/db` | Schema, migrations, seed, tenant-scoped data access |
| `packages/integrations` | Typed clients: claude, google-search-console, ga4, meta, linkedin, email |
| `packages/seo` | crawler, audits, keywords, rankings logic |
| `packages/reports` | Report data builder, PDF/email rendering |
| `packages/config` | Shared tsconfig, eslint config, env validation |
| `docker/` | Compose and Caddyfile |

Dependency direction: `apps/*` -> `packages/*`; packages never import apps. `db` is the only
package that talks to Postgres.

## 3. Multi-tenancy

- Tenant = customer. Every customer-owned table has a `customer_id` column (indexed, first column of composite indexes).
- All data access goes through `packages/db` functions that take `customerId` explicitly (or a scoped client created per customer). No unscoped queries on tenant tables outside clearly named admin/system helpers.
- Users reach customers only through `memberships`; web requests check membership before any query.
- Jobs receive `customerId` in their payload and use scoped access.
- Per-customer behavior is data (settings, keywords, competitors, brand voice, schedule, report email, connected accounts), never code.

## 4. Web app (`apps/web`)

- Next.js App Router, React Server Components for reads, server actions/route handlers for writes.
- Auth: session-based, roles admin/member/viewer via memberships.
- The web app **never does long-running work**. It writes a record and enqueues a job, or reads stored results.
- `/api/health` checks the process, database and Redis.
- Validation with Zod at every boundary.

## 5. Worker (`apps/worker`)

- Separate Node process using BullMQ + Redis.
- Queues: `rank-check`, `site-audit`, `analytics-sync`, `content-generate`, `publish-post`, `report-15day`, `alert-notify` (+ a `heartbeat`).
- A scheduler registers repeatable jobs. Each scheduled job is generic: it loads all **active** customers and enqueues (or runs) one unit of work per customer, using that customer's settings.
- Every execution writes a `job_runs` row (queue, customer, status, started/finished, error, attempts).
- Retries with exponential backoff; per-queue concurrency and rate limits to respect external APIs.
- Idempotent handlers: re-running a job must not duplicate posts, reports or changes.

## 6. Data layer

- PostgreSQL. ORM/query layer chosen in `decisions.md`.
- Migrations live in `packages/db`. Seed creates SARJ Worldwide and an admin user.
- Time-series data (rankings, analytics snapshots) is append-only with timestamps.
- See `data-model.md` for tables and relationships.

## 7. Integrations

- Each external service is a typed client in `packages/integrations` behind an interface, so providers can be swapped and mocked in tests.
- Claude API is called **only** through one wrapper in `packages/integrations/claude` (prompt templates, token/usage logging per customer, retries, JSON output validated with Zod).
- Email is provider-agnostic (`Mailer` interface); Resend/Brevo/SES implemented later.
- OAuth tokens are encrypted at rest (see `security.md`).

## 8. Approval and change-log pipeline

Anything that changes a customer's website or publishes content follows one path:

```
propose -> pending approval -> approved (by a human) -> executed by worker -> change_log entry
                         \-> rejected (reason stored)
```

- `approvals` records who decided, when and why.
- `change_log` records what was changed, before/after, the approval id, and the executing job.
- The worker refuses to execute an item that lacks an approved approval.

## 9. Observability

- `job_runs` is the source of truth for job history; surfaced in the dashboard.
- Structured JSON logs from web and worker.
- Health route and worker heartbeat; alerts via the `alert-notify` queue.

## 10. Deployment

Single Hostinger VPS, Docker Compose: web, worker, postgres, redis, caddy. See `deployment.md`.

## 11. Scaling notes

Sized for 15-50 customers on one VPS. If load grows: raise worker concurrency, add worker
replicas (BullMQ supports this), move Postgres/Redis to managed services. No tenant-per-database
split is planned.
