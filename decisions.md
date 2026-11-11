# Decisions

Architecture decision records. Newest at the bottom. Status: accepted, proposed, superseded.

## ADR-001: Monorepo with npm workspaces and Turborepo
Status: accepted. One repo for web, worker and shared packages gives shared types and one
install. Turborepo orchestrates `dev`/`build`/`lint`.

## ADR-002: Multi-tenant single database with `customer_id`
Status: accepted. One codebase, one database; every customer-owned table carries `customer_id`
and every query is scoped. Cheaper to run and onboard than a database per customer at 15+ tenants.
Isolation is enforced in the data layer and covered by tests.

## ADR-003: Generic scheduled jobs
Status: accepted. Jobs loop over active customers and read behavior from data. No per-customer
code or workflows.

## ADR-004: Separate worker process
Status: accepted. Crawls, rank checks, publishing and reports run in `apps/worker` (BullMQ +
Redis), never in Next.js requests, to keep the UI responsive and jobs retryable.

## ADR-005: Approval + change log for outward actions
Status: accepted. Website changes and publishing need an approved approval and a change_log entry.

## ADR-006: Encrypt third-party tokens at rest
Status: accepted. AES-256-GCM with a key from env, key id stored with the ciphertext for rotation.

## ADR-007: Single Claude wrapper
Status: accepted. All AI calls go through `packages/integrations/claude` for usage logging,
validation and cost control.

## ADR-008: Docker Compose on one VPS with Caddy
Status: accepted. Simple operations for the expected scale; managed services later if needed.

## ADR-009: ORM choice (Prisma vs Drizzle)
Status: proposed. Recommendation: Prisma for migrations/seed ergonomics and a client extension
point for enforcing `customer_id` scoping. Decide at the start of phase 1.

## ADR-010: Auth library (Better Auth vs Auth.js)
Status: proposed. Recommendation: Better Auth (TypeScript-first, active). Email+password, no public
sign-up. Decide in phase 1.

## ADR-011: Rank data source
Status: proposed. Search Console positions (free, aggregated) vs a paid SERP API (exact daily).
Decide before phase 3; the `rankings.source` column allows both.

## ADR-012: How website fixes are applied
Status: proposed. Per-stack adapters (CMS API, Git PR, manual patch export). Start with patch
export in phase 4; add adapters per customer stack.

## ADR-013: npm run build scripts allowlist
Status: accepted. npm 12 blocks install scripts by default; `allowBuilds` in
`npm-workspace.yaml` permits `esbuild` and `sharp`.
