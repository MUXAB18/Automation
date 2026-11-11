# Data Model

> **Superseded.** The implemented schema (Agency > Client hierarchy, 62 models) is documented in
> [docs/database-erd.md](docs/database-erd.md). The table below is the original Phase 1 plan, kept for history.

Planned PostgreSQL schema (original plan). `customer_id` = tenant key (now `client_id` + `agency_id`).

## Conventions

- Primary keys: UUID (`id`). Timestamps: `created_at`, `updated_at` (UTC).
- Every table marked **tenant** has `customer_id` (FK -> customers, NOT NULL, indexed, first column of composite indexes).
- History tables are append-only.
- Secrets (tokens) are stored encrypted, never plain.

## Tables

| Table | Tenant | Purpose | Key columns |
| --- | --- | --- | --- |
| customers | root | A business we manage | name, status (active/paused/archived), settings (brand voice, schedule, report email), timezone |
| websites | yes | Customer sites | domain, cms_type, verified |
| users | no | People who log in | email, name, password hash / auth ids, is_admin |
| memberships | yes | user <-> customer + role | user_id, customer_id, role (admin/member/viewer) |
| keywords | yes | Tracked keywords | website_id, term, locale, target_url, active |
| rankings | yes | Rank history | keyword_id, position, url, source, checked_at |
| competitors | yes | Competitor domains | domain, notes |
| audits | yes | Site audit runs | website_id, status, score, started_at, finished_at |
| audit_issues | yes | Findings of an audit | audit_id, rule, severity, url, details, status |
| content_items | yes | Social/site content | type, body, platform, status (draft/approved/scheduled/published), scheduled_at, ai_generated |
| social_accounts | yes | Connected accounts | platform, handle, token_encrypted, refresh_encrypted, expires_at |
| posts | yes | Published/scheduled posts | content_item_id, social_account_id, external_id, status, published_at, engagement |
| analytics_snapshots | yes | GA4/GSC/social metrics | source, date, metrics (jsonb) |
| reports | yes | Generated reports | period_start, period_end, status, file_ref, sent_to, sent_at |
| approvals | yes | Human decisions | subject_type, subject_id, status (pending/approved/rejected), requested_by, decided_by, decided_at, note |
| change_log | yes | Applied changes (immutable) | subject_type, subject_id, approval_id, before, after, applied_by, job_run_id, applied_at |
| job_runs | yes (nullable for system jobs) | Every job execution | queue, customer_id, status, attempts, started_at, finished_at, error |

`users` is global; access to customers is only through `memberships`.

## Relationships (summary)

```
customers 1-* websites 1-* keywords 1-* rankings
customers 1-* competitors
websites  1-* audits 1-* audit_issues
customers 1-* content_items 1-* posts *-1 social_accounts
customers 1-* analytics_snapshots, reports, approvals, change_log, job_runs
users *-* customers (via memberships)
```

## Indexes (initial)

- `(customer_id, ...)` on every tenant table.
- `rankings (customer_id, keyword_id, checked_at desc)`.
- `analytics_snapshots (customer_id, source, date)` unique.
- `content_items (customer_id, status, scheduled_at)`.
- `job_runs (customer_id, queue, started_at desc)`.
- `approvals (customer_id, status)`.

## Integrity rules

- Composite FKs or checks ensure child rows share their parent's `customer_id` (no cross-tenant references).
- `change_log` and `approvals` decisions are never updated or deleted by application code.
- Deleting a customer is a soft archive; hard delete is a manual admin operation.

## Seed

One customer "SARJ Worldwide" (website sarjworldwide.ca) with a few placeholder keywords, plus one admin user.
