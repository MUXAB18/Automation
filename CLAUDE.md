# CLAUDE.md

Internal AI-powered SEO & Social Media Automation platform. One codebase manages 15+
customers (businesses). First test customer: SARJ Worldwide (sarjworldwide.ca).

## Rules for every session

1. **Multi-tenant from day one.** Every customer-owned table has `customer_id`, and every query is scoped by it.
2. **Scheduled jobs loop over all active customers.** Never write per-customer code or workflows.
3. **Per-customer behavior comes from settings/data** (keywords, competitors, brand voice, schedule, report email), not code.
4. **Long-running work runs in the worker** (`apps/worker`), never inside Next.js requests.
5. **Encrypt stored third-party tokens** (social, Google) at rest.
6. **Website changes and publishing require an approval step and a change log entry.**
7. **TypeScript strict mode, Zod for validation.**

## Layout

- `apps/web` Next.js dashboard; `apps/worker` BullMQ worker (Node.js)
- `packages/{db,integrations,seo,reports,config}` shared code
- `docker/` Compose + Caddy; `docs/` architecture and decisions

## Commands

- `pnpm install` install dependencies
- `pnpm dev` run web and worker
- `pnpm build` / `pnpm lint` via Turborepo
