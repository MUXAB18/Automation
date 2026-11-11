# SEO monitoring and automation engine (Phase 11)

Rules watch **synchronised** SEO and analytics data and turn problems into findings, tasks and notifications.
Nothing here edits a website: the engine only creates records, tasks and notifications.

## Flow of one run

1. The worker tick (`apps/worker/src/jobs/automation-dispatch.ts`, every `AUTOMATION_POLL_INTERVAL_MS`) retries
   failed runs whose time has come, queues a run for every active rule that is due (one per rule per interval,
   enforced by an idempotency key) and executes queued runs.
2. **Validate**: the evaluator checks that source data exists and is fresh. Missing or stale data makes the run
   `skipped` with a reason; it never produces findings or tasks from old data.
3. **Evaluate** the rule's conditions into findings, each with a stable `dedupeKey`.
4. Per finding: record or update the `AutomationFinding` (unique per client and key), link an existing open task or
   issue if there is one, otherwise (unless capped or cooling down) assign, set priority from severity, compute the
   due date in the client's time zone, render title/description/acceptance criteria and create the task.
5. Notify the assignee, managers and reviewers as the rule says, once per new, reopened or escalated finding.
6. A finding whose condition no longer holds (with fresh data) is resolved. Tasks are never closed automatically.
7. Every step is stored in `automation_step_runs`; the summary is on the run.

## The seven rules

| Type | Fires when | Dedupe key |
| --- | --- | --- |
| `keyword_rank_drop` | A keyword tagged important lost N positions against `compareDays` ago | `kw-drop:<keyword>` |
| `critical_audit_issue` | The latest completed audit has an open issue at or above the severity | `issue:<issue>` |
| `page_needs_optimization` | A page has high impressions, mid position and low CTR | `page-opt:<source>:<hash>` |
| `organic_traffic_drop` | GA4 organic sessions or GSC clicks fell by N% against the previous window | `traffic-drop:<source>:<metric>` |
| `content_deadline_approaching` | Unapproved content is scheduled within N hours (or just missed) | `content:<item>:<day>` |
| `task_overdue` | An open task is past its due date | `overdue:<task>` |
| `integration_failing` | The last N syncs of a real (non-mock) account failed, or it needs reconnecting | `integration:<account>` |

Each rule has: name, severity, client (and optional project), enabled/paused, check interval, kind-specific
conditions, assignment, task template, due-date policy, notification policy and cooldown. Recommended rules are
installed **paused**; a person reviews and enables them. Agency templates roll one rule out to every active client;
a client's edited copy (`customized`) is never overwritten.

## Preventing duplicates and loops

- `automation_findings` is unique on `(client_id, dedupe_key)`: two rules or two runs share one finding.
- `tasks.automation_key` has a partial unique index while the task is open: the database refuses a second open task
  for the same condition, even under a race. The engine then links the existing task.
- `createTaskForAutomation` also takes an idempotency key (`dedupeKey:taskCount`), so a retried run returns the task
  it already made.
- One active run per rule (partial unique index) and one queued run per rule per interval.
- Rules run on a schedule only, never on task events, and `task_overdue` is notify-only: a task can never cause more
  tasks. Per-run and open-task caps and a cooldown after a task is closed stop floods.

## Assignment

`role` (least-loaded or first), `entity_owner` (falls back to the role), `review_queue`, or a named user. Only people
who hold `task.manage` on the client qualify. If nobody does, the task is created unassigned and reviewers are told.

## Failures and retries

Evaluator or step errors are stored with a safe message. Retryable failures are re-queued with exponential back-off up
to three attempts (`next_attempt_at`); configuration errors are not retried. A run stuck in `running` (worker crash) is
failed and retried. Re-executing a finished run does nothing.

## Pages and permissions

`/automation` (rules), `/automation/runs` (history and step detail), `/automation/findings`, `/automation/templates`
(agency admins). `automation.view` reads; `automation.manage` creates, edits, pauses, runs and deletes; templates need
`agency.manage`. Everything is checked on the server and scoped to the clients the person may access.
