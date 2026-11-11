# Design

Product and UX design for the dashboard (`apps/web`). Technical design lives in `architecture.md`.

## 1. Principles

- **Customer-first navigation:** one dashboard, always inside a selected customer (or the cross-customer overview for admins).
- **Review is the main job:** the UI is built around queues of things waiting for a human decision.
- **Show state, not mechanics:** users see "Audit finished, 12 issues", not queue names.
- **Safe by default:** nothing outward-facing happens without an explicit approval click.
- **Dense but calm:** tables and charts first; minimal decoration.

## 2. Information architecture

```
/                         Overview (all customers, admin) or redirect to last customer
/customers                Customer list + create
/c/[customerId]           Customer home (health, alerts, next actions)
  /seo
    /keywords             Keyword list, rank history
    /audits               Audit runs, issues
    /competitors          Competitor list, comparison
    /recommendations      AI recommendations
  /social
    /content              Content items (draft/approved/scheduled/published)
    /calendar             Schedule view
    /accounts             Connected accounts
  /website
    /changes              Proposed fixes awaiting approval + change log
  /analytics              Rankings, traffic, keywords, engagement
  /reports                Report history, preview, resend
  /settings               Brand voice, schedule, report email, websites, members
/approvals                Global approval inbox
/jobs                     Job runs and failures (admin)
/settings                 Users, integrations, system
/login
```

## 3. Key screens

1. **Overview (admin):** table of all customers with status, last report, open approvals, failed jobs, ranking trend.
2. **Customer home:** KPI tiles (avg position, clicks, sessions, engagement), alerts, next scheduled jobs, pending approvals.
3. **Keywords:** sortable table with current/previous position, volume, trend sparkline; add/import.
4. **Audit detail:** summary score, issues grouped by severity and type, "propose fix" action per issue.
5. **Content editor:** AI draft, edit, hashtag suggestions, platform preview, submit for approval.
6. **Calendar:** month/week view of scheduled posts, drag to reschedule.
7. **Approval inbox:** unified queue (content, website fix, report). Each item: diff/preview, approve, reject with note.
8. **Change log:** immutable list of applied changes with who approved, before/after.
9. **Reports:** list of 15-day reports; preview, download PDF, resend.
10. **Job runs:** filter by queue/customer/status; error detail; retry.

## 4. Key flows

- **Onboard a customer:** create customer -> add website -> connect Google (OAuth) -> add keywords/competitors -> set brand voice and report email -> activate. First audit and rank check run automatically.
- **Approve content:** draft appears in inbox -> reviewer edits/approves -> scheduled -> worker publishes -> status updates to published.
- **Approve website fix:** audit issue -> proposed fix with diff -> approve -> applied by worker -> change log entry -> follow-up audit verifies.
- **Receive report:** worker builds report -> status "sent" -> emailed to customer contact -> visible under Reports.

## 5. Roles in the UI

- admin: all areas, system settings, user management.
- member: only assigned customers; can approve.
- viewer: read-only; approval buttons and settings hidden.

## 6. Visual design

- Tailwind CSS with shadcn/ui components (added in phase 1); Recharts for charts.
- Neutral palette with one accent color; semantic colors for status (success, warning, error, info).
- Light and dark mode via CSS variables.
- Typography: one sans-serif family, tabular numbers for metrics.
- Accessible: keyboard navigable, visible focus, color never the only signal.

## 7. States

Every list and chart defines: loading (skeleton), empty (with next action), error (with retry), and stale-data notice (last synced time).

## 8. Notifications

- In-app badge for pending approvals and failed jobs.
- Email for: approval needed, job failure, report sent (to team), report delivery to customer.
