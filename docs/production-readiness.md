# Production readiness checklist

Status as of the Phase 15 pass (2026-11-01). **Verdict: not yet declared production-ready.** Every automated
check below passed, but the items in sections 2, 3, 4 and 5 are open and must be closed or accepted first.

## Check results (run locally, against a throwaway test database)

| Check | Result |
| --- | --- |
| `npm run typecheck` (6 packages) | Passed |
| `npm run lint` (6 packages) | Passed |
| `npm run test` | Passed: config 17, reports 3, worker 14, integrations 87, web 79, db 461 (db tests are real PostgreSQL integration tests on `TEST_DATABASE_URL`) |
| `npm run ml:test` (Python service) | Passed (13) |
| `npm run build` | Passed |
| `scripts/smoke.mjs` against `next start` of the production build | Passed (19 checks: health, headers, anonymous access refused, public sign-up disabled, foreign-origin sign-in refused) |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |
| `docker compose config` for base and production files | Valid |
| Browser end-to-end tests (signed-in flows) | **Not run: no browser test suite exists** |
| Docker image builds, full stack boot, worker against real Redis | **Not run**: Docker daemon and Redis were not available in this environment |
| GitHub Actions workflow | **Not run**: written but never executed on GitHub |
| Backup / restore rehearsal | **Not run** |

## 1. Fully implemented and tested

- Multi-tenant isolation: composite keys, scoped client, cross-client/cross-agency tests, `TENANT_MODELS` guard test.
- Server-side authorisation on every page/action/route (`requireActor`, `requirePermission`); anonymous and
  cross-tenant requests answer 404, missing permission 403. Routes re-reviewed this pass; unchanged.
- Credentials encrypted at rest (AES-256-GCM, bound to the client, key rotation), never present in views, logs or errors.
- Structured JSON logging with secret redaction (new, unit-tested); all server `console.*` calls replaced.
- Auth throttling (email + IP, DB-backed); new per-user quotas on report PDF export and OAuth starts (HTTP 429, unit-tested).
- Security headers incl. HSTS (production), frame/base/form/object CSP directives, token pages `no-store`.
- Provider layer: timeouts on every outbound call, 429/5xx/network mapping with `Retry-After`, retry limits, expired/revoked
  credential handling (`needs_reauth`), partial-sync results, looping-cursor guard.
- Background jobs: one run per account (DB-enforced), retries with backoff up to an attempt limit, crashed-run reaping,
  publishing idempotency (one job per version+account, request stamped before the call, unclear outcomes held for a person, never auto-retried).
- Report generation/delivery failure marking and manual retry; scheduled loops over all active clients; failure of one client does not stop others.
- Worker runs without any browser session (all loops in `apps/worker`).
- Health: web `/api/health` (DB), worker `/health` (DB, Redis, loop liveness; pure logic unit-tested); Compose healthchecks.
- Worker crash handling: unhandled rejections exit loudly for restart; bounded graceful shutdown.
- Environment validation with fail-fast Zod schemas; `log` mail transport refused in production; sample data skipped in production seed.
- Documentation: `docs/production.md`, `docs/operations.md`, this file.

## 2. Implemented but requires live credentials (code and mocks tested; not exercised against the real service)

- Google Analytics 4 and Search Console (OAuth client or service account).
- SE Ranking (API key; plan-restricted features are reported as unsupported).
- GoHighLevel marketplace app OAuth and read sync (contacts, opportunities, conversations, social stats).
- Resend email (invitations, password reset, report delivery): needs `EMAIL_API_KEY` and a verified sender.
- AI generation with a real provider (`anthropic` / `openai_compatible`); the mock provider is what is tested.
- Managed TLS via Caddy: needs a real domain and DNS.

## 3. Partially implemented

- **End-to-end testing**: only an HTTP smoke test exists. Signed-in flows (login, approvals, publishing, reports) are covered by
  service-level integration tests, not by a browser. Add Playwright before relying on UI regressions being caught.
- **GoHighLevel publishing**: logic, idempotency and outcome handling are tested with mocks, but posting is unverified against
  a real account, so `GHL_PUBLISHING_ENABLED` defaults to `0`. Do not enable it without a sandbox-location test.
- **Retention**: documented suggestions only; no pruning job for `sync_errors`, processed webhook payloads or expired tokens.
- **Key rotation**: old keys decrypt and are flagged, but no bulk re-encryption job was verified.
- **n8n**: deployable as an optional profile; nothing in the app calls it (see below).
- **Rate limiting**: application-level limits exist for auth, PDF, OAuth starts and AI; there is no global per-IP limit at the proxy.
- **Strict script CSP**: only non-script directives are set; a nonce-based script policy needs Next.js middleware work and testing.
- **Monitoring**: health endpoints and JSON logs are in place, but no metrics endpoint, alert rules or dashboards were created.

## 4. Unsupported by provider APIs (or not implemented because of them)

- GoHighLevel webhooks exist (RSA `x-wh-signature`) but are **not implemented**; data is polled. There is no inbound webhook
  endpoint, so webhook signature validation and duplicate-delivery handling could not be tested end to end. The
  `webhook_events` table with `(integration_id, external_event_id)` uniqueness is ready for it.
- SE Ranking and Google Analytics/Search Console document no webhooks; polling only.
- GoHighLevel: agency-level installs, per-post performance and scheduling posts on their side are not supported by what the app uses.
- Google Search Console data is final only after ~2–3 days; the sync marks the newest days provisional.

## 5. Remaining operational requirements (before go-live)

1. Run `docker compose … up` for real and the worker against real Redis; confirm both health endpoints and the migrate service.
2. Push to GitHub and get the CI workflow green; fix whatever differs from the local environment.
3. Create `.env.production` (docs/production.md), store `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` in a secret store.
4. Configure DNS, `SITE_ADDRESS`, Resend sender, and each provider's OAuth app / keys.
5. Schedule `backup`, copy dumps off-host, and **rehearse a restore** into `automation_restore`; record the time taken.
6. Decide on log shipping and alerts for the signals in `docs/operations.md`; add an external uptime monitor.
7. Add Playwright coverage for sign-in, approval → publish and report download; run against staging.
8. Test GoHighLevel posting in a sandbox location before enabling `GHL_PUBLISHING_ENABLED=1`.
9. Create a staging environment; only then consider automated deploys.
10. Run `npm audit` and image scans on a schedule; review `ENCRYPTION_KEY` rotation drill once.
