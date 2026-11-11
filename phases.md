# Phases

Delivery plan, in build order. Each phase ends in something usable and testable. Statuses:
`todo`, `doing`, `done`.

## Phase 0: Project structure (done)
Monorepo, empty web and worker apps, folder layout, CLAUDE.md rules, docs.

Exit: `npm install` works, `npm run dev` starts web and worker.

## Phase 1: Foundation (todo)
- Postgres + Redis locally (Docker Compose for dev), env validation (Zod, fail fast).
- Database layer, migrations for all tables, tenant-scoped access helpers, seed (SARJ Worldwide + admin).
- Auth with roles (admin/member/viewer) and memberships.
- Basic dashboard: customer list, customer home, `/api/health`.
- Worker skeleton: BullMQ, scheduler, `job_runs` wrapper, heartbeat job.
- Lint, typecheck, Vitest, CI.

Exit: log in as admin, see SARJ in the dashboard, heartbeat job logs to `job_runs`; lint, typecheck and tests pass.

## Phase 2: Customer setup (todo)
- Customer CRUD, websites, members, per-customer settings (brand voice, schedule, report email).
- Keywords and competitors management (add/import).
- Google OAuth connection per customer; encrypted token storage.

Exit: onboard a new customer end to end with no code changes.

## Phase 3: SEO core (todo)
- Search Console and GA4 clients, `analytics-sync` job and snapshots.
- Rank tracking (`rank-check`) with history and trend charts.
- Crawler and audit rules (`site-audit`), issue list.
- Competitor snapshots.
- Analytics dashboard v1 (rankings, traffic, keyword performance).

Exit: scheduled rank checks, audits and analytics syncs run for all active customers; dashboard shows real data.

## Phase 4: Approvals and website optimization (todo)
- Approvals inbox, `approvals` and `change_log` pipeline.
- Fix proposals from audit issues; apply mechanism (per-stack adapter, first: manual/patch export).
- Verification audit after a fix.

Exit: an approved fix is applied, logged, and verified; unapproved items cannot execute.

## Phase 5: AI recommendations and content (todo)
- Claude wrapper (usage logging, structured output).
- AI recommendations from audit, ranking and analytics data.
- `content-generate`: drafts, captions, hashtags in brand voice.
- Content lifecycle: draft -> approved -> scheduled -> published.

Exit: AI drafts land in the approval inbox and can be approved or rejected.

## Phase 6: Social publishing (todo)
- Meta and LinkedIn OAuth and publishing clients.
- `publish-post` job, content calendar, engagement sync.
- Social engagement analytics.

Exit: an approved post is published on schedule and engagement shows in analytics.

## Phase 7: Reports and alerts (todo)
- Report data builder, PDF/HTML templates.
- `report-15day` job; mailer interface with first provider; delivery tracking.
- `alert-notify`: approvals needed, job failures, report events.

Exit: every active customer gets a report every 15 days automatically.

## Phase 8: Production and scale (todo)
- Docker Compose for web, worker, postgres, redis, caddy; Hostinger VPS deploy; HTTPS.
- Backups, restore drill, log rotation, monitoring.
- Onboard customers 2 to 15+; tune concurrency and rate limits.
- Security review.

Exit: production stable with 15+ customers.

## Phase 9: Improve (later)
- Feedback loop: track which recommendations helped.
- Customer-facing read-only portal (viewer role).
- More social networks, more CMS adapters, A/B testing of titles and captions.

## Dependency order

```
0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9
          (7 can start after 3 using SEO data only; 6 needs 5)
```
