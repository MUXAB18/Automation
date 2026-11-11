# CLAUDE.md

Internal AI-powered SEO & Social Media Automation platform. One codebase manages 15+
clients (businesses). First test client: SARJ Worldwide (sarjworldwide.ca).

## Rules for every session

1. **Multi-tenant from day one.** Agency > Client. Every client-owned table has `agency_id` + `client_id` with composite foreign keys (no cross-client or cross-agency links), and every query is scoped by client. See `docs/database-erd.md`.
2. **Scheduled jobs loop over all active clients.** Never write per-client code or workflows.
3. **Per-client behavior comes from settings/data** (keywords, competitors, brand voice, schedule, report email), not code.
4. **Long-running work runs in the worker** (`apps/worker`), never inside Next.js requests.
5. **Encrypt stored third-party tokens** (social, Google) at rest.
6. **Website changes and publishing require an approval step and a change log entry.**
7. **TypeScript strict mode, Zod for validation.**

## Layout

- `apps/web` Next.js dashboard; `apps/worker` BullMQ worker (Node.js)
- `packages/{db,integrations,seo,reports,config}` shared code
- `docker/` Compose + Caddy
- Root docs: `prd.md`, `design.md`, `architecture.md`, `phases.md`, `data-model.md`, `jobs-and-workflows.md`, `integrations.md`, `security.md`, `deployment.md`, `conventions.md`, `decisions.md`, `glossary.md`

## Data access

- Never use the raw Prisma client in app code. Use `forClient(id)`, `getActorDb(actor)`,
  `getClientContext(actor, id)` or the services in `@automation/db`. `forAdmin(actor)` and
  `forSystem()` are the only unscoped entry points (platform admins / the worker).
- `@automation/db/unsafe` is for the auth adapter, seed and the data layer itself.
- New tenant table: add `agency_id` + `client_id` with the composite client relation and `@@unique([id, clientId])`, add the model to `TENANT_MODELS` in `packages/db/src/scope.ts`
  (a test fails if you forget), and write a cross-client test.
- Every create/update/delete of client data writes `audit_log` in the same transaction.
- Roles: `users.is_admin` = platform admin; per-client `memberships.role` = admin / member / viewer.
  Enforce permissions on the server (`requirePermission`), not only in the UI.

## Auth and permissions

- Better Auth (email + password, DB sessions); sign-up disabled, accounts come from invitations or the seed script.
- Seven roles (Agency Admin, SEO Manager, SEO Specialist, Content Writer, Social Media Manager, Reviewer, Client); a user may hold several, permissions are the union.
- Every page and server action starts with `requireActor()` and authorises with `authorize()` / `requirePermission()` from `@automation/db`; ids from URLs/forms are untrusted.
  No access = `NotFoundError`, missing permission = `ForbiddenError`. Never decide access in client components. Details: `docs/auth.md`.

## UI

- shadcn/ui + Tailwind tokens in `apps/web`; shared building blocks and conventions are in `docs/design-system.md`.
- Section pages: `requireActor()` then `requireSection()`; lists come from `packages/db/src/services/workspace.ts`.
- Mark unbuilt features with `DevelopmentNotice` and seed rows with `is_sample`; never add controls that do nothing.

## Commands

- `npm install` install dependencies (also generates the Prisma client)
- `npm run dev` run web and worker; `npm run build` / `npm run lint` / `npm run typecheck` / `npm run test`
- `npm run db:migrate` (dev) / `npm run db:deploy` / `npm run db:seed`
