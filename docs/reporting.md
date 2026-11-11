# Analytics and reporting (Phase 14)

## Where every number comes from

`packages/db/src/reporting/metrics.ts` is the only source of figures for dashboards, reports and the portal. It reads
stored records: synced `metric_snapshots` (latest reading per source, metric and day, so a re-sync replaces a revised
day), `keyword_rank_snapshots`, tasks, SEO issues, `published_posts` / `manual_publications`, post metric snapshots,
integration accounts and the AI ledger.

Rules:
- A metric that cannot be calculated is `null` with a state: `no_source` (nothing connected), `no_data` (connected, nothing
  synced for the period) or `partial` (under 70 % of the days have data, stated in the note). It is never zero-filled.
- CTR is derived from summed clicks and impressions; average position is weighted by impressions; engagement rate is engaged
  sessions over sessions. Each comparison is against the previous period of the same length, only when both have data.
- Development mock data is excluded everywhere except the staff dashboard in development, where it is labelled. Reports and
  the portal never include it.
- Internal figures (AI usage and cost, overdue tasks) are only calculated for staff (`automation.view` on every included
  client); a client's people never receive them.
- `validateAll` (document.ts) re-checks every metric before it is stored or shown: shape, finite, non-negative and inside its
  possible range (CTR and engagement 0-100, position at least 1). A failing metric becomes "not shown".

## Dashboards

`/analytics/dashboard` (Recharts charts, date presets and custom range, freshness strip, empty and loading states). Level
follows the header scope: all clients = agency (with a per-client comparison table), a client, or a project (project filters
tasks, issues, keywords, social content and analytics sources of the project's website).

## Reports

Sections: executive summary, SEO performance, search and traffic, social media, work completed, outstanding issues,
recommendations, data sources and freshness. The agency template chooses which appear, the title pattern, the default
interval (15 days) and whether AI writes the summary.

1. **Period.** Consecutive windows of N calendar days from an anchor, in the client's time zone (`periods.ts`); a period is
   generated at the schedule's local hour on the day after it ends. Missed runs collapse into the latest period.
2. **Generate (worker).** Metrics are collected, validated, frozen as `report_data_snapshots` (with a stable SHA-256 of the
   data) and written as `report_sections`. Recommendations come from fixed rules over the figures, each stating the figure it
   rests on.
3. **Summary.** Fixed-wording by default. With `useAi` and a real provider, the model is given only the report's figures; its
   answer is Zod-validated and every cited figure must match a supplied one, otherwise the fixed wording is used. The mock
   provider is never used for client-facing text. The AI job and its cost are recorded.
4. **Review.** A report is `ready`; a person with `report.approve` approves or sends it back. The requester of a manual report
   cannot approve it. Clients see a report only once approved or delivered.
5. **Delivery.** After approval the schedule's recipients are queued (or staff send to others). One delivery row per report and
   recipient (lower-cased, unique): the same address is never sent the same report twice. The worker claims with SKIP LOCKED,
   renders the PDF (`@automation/reports`, pdfkit), stamps `request_sent_at`, then calls the mail provider with an idempotency
   key. Rate limits and outages retry with backoff (4 attempts); a refusal fails; an unknown outcome (and a worker that died
   mid-send) becomes `needs_review` and is never retried automatically. Every try is kept in `report_delivery_attempts`.
   Manual **Resend** reuses the same row (a new idempotency key, `resend_count` + 1).
6. **Duplicates.** `reports` is unique on client, period and revision; the schedule creates revision 1 once and advances with a
   compare-and-set, so repeated ticks or two workers produce one report.

## Client portal

`/portal` has its own shell. Client-only users are redirected there from every agency page. It uses the same authorised
services: their own client's approved reports (and PDF), a 28-day performance view without internal figures, and content
waiting for their approval (`/portal/approvals/[id]`, only content that has reached the client stage). Other clients' ids,
drafts and unapproved reports answer "not found".

## Configuration

Worker: `MAIL_TRANSPORT` (`log` in development; refused in production), `EMAIL_API_KEY`, `EMAIL_FROM`,
`REPORT_POLL_INTERVAL_MS`, plus the AI variables from `docs/ai-generation.md`.
