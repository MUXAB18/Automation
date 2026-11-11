# Jobs and Workflows

All background work runs in `apps/worker` on BullMQ + Redis.

## Rules

1. Scheduled jobs are generic: load all **active** customers, process each with that customer's settings.
2. No per-customer queues, jobs or code.
3. Handlers are idempotent and retry-safe.
4. Every execution writes a `job_runs` row (start, finish, status, attempts, error).
5. Anything that changes a website or publishes content requires an approved approval and writes `change_log`.

## Queues

| Queue | Trigger | What it does | Output |
| --- | --- | --- | --- |
| rank-check | daily | Fetch positions for active keywords | `rankings` rows |
| site-audit | weekly | Crawl, run audit rules | `audits`, `audit_issues` |
| analytics-sync | daily | Pull GSC, GA4, social metrics | `analytics_snapshots` |
| content-generate | weekly / on demand | Claude drafts posts in brand voice | `content_items` (draft) + approval request |
| publish-post | scheduled time | Publish approved, scheduled items | `posts`, status published |
| report-15day | every 15 days per customer | Build and email report | `reports`, email sent |
| alert-notify | event-driven | Tell humans something needs attention | email / in-app notification |
| heartbeat | every minute | Proves the worker is alive | log + `job_runs` |

Schedules are defaults; per-customer overrides come from customer settings (data).

## Generic scheduler pattern

```
repeatable job fires
  -> load active customers
  -> for each customer: enqueue unit job {customerId}  (own retries, own job_runs row)
```

One failing customer never blocks the others.

## Report cadence

`report-15day` runs daily, selects customers whose last report ended 15+ days ago (or whose
next-due date has passed), and generates one for each. This keeps cadence data-driven and
tolerant of downtime.

## Approval workflow

```
create proposal -> approvals(pending) -> alert-notify
   human approves -> approvals(approved)
        -> worker executes -> change_log entry -> status updated
   human rejects  -> approvals(rejected, note)
```

The executing handler re-checks the approval status right before acting.

## Failure handling

- Retries: exponential backoff, limited attempts per queue.
- After final failure: `job_runs.status = failed`, `alert-notify` emits a failure alert.
- Dead jobs are visible in the Job runs screen with a retry action.
- External rate limits: per-queue limiter and per-provider concurrency caps.

## Idempotency keys

- Rankings: `(keyword_id, checked_at date, source)`.
- Analytics: `(customer_id, source, date)`.
- Posts: `content_item_id` + account, with external id stored after success.
- Reports: `(customer_id, period_start, period_end)`.
