# Social and content workflow (Phase 13)

## Lifecycle

`idea → brief → draft → in_review (internal) → client_approval (only if required) → approved → scheduled → publishing →
published`. Side states: `changes_requested`, `rejected`, `failed` (publishing failed), `cancelled`. The allowed moves are
the `CONTENT_TRANSITIONS` table in `services/content-workflow.ts`; every move writes `content_status_events` and an audit
row in the same transaction.

- **Versions are immutable.** Every edit, AI draft and restore adds the next version (`content_versions`). An approval is
  tied to exactly one version. Editing approved or in-review text cancels the open request and returns the item to `draft`.
- **Review.** Authors cannot approve their own version. Internal review needs `content.approve`; the client stage needs the
  client role, and cannot be given before internal review passes. Changes/rejection need a reason (stored as a comment).
- **Publishing needs approvals for exactly the current version** (internal, and client when required), enforced in
  `requestPublish` and by the database trigger on `publishing_jobs`.

## Time zones

Schedules are entered as wall time in the **client's** time zone and converted once to a UTC instant
(`time-zone.ts`): a time that does not exist (spring forward) is refused, a time that happens twice (fall back) means the
earlier one. The zone used is stored on the item. The calendar places each item on its client's local day.

## Publishing pipeline

1. **Validate** text and media for the channel (`content-validation.ts`: length, hashtags, media required/limits, types,
   sizes, banned terms). 2. **Verify** the connected account is active and non-mock and has a profile matching the channel.
3. **Verify approvals.** 4. **Create the durable job** (`publishing_jobs`, one per version and account; a cancelled job is
reused when rescheduling). 5. The worker submits through the provider adapter. 6. The provider response and external post id
are recorded (`published_posts`). 7. Status is updated, 8. history is written and 9. the creator, assignee and requester are
notified (success, failure, needs-review).

Duplicates: unique job per version and account, `request_sent_at` before the provider call, an unknown outcome becomes
`needs_review` (never retried automatically), unique provider post id per account. Rate limits are retried later; refusals
fail permanently and are flagged.

## Provider capabilities and manual fallback

`PROVIDER_CAPABILITIES` states what a provider really does: the GoHighLevel adapter posts text only. Website and email
content, posts with media, and channels without a matching profile are **manual**: the item is scheduled for a person to post
and then recorded with `markPublishedManually` (link, time, note; one record per version; refused when a direct job exists so
it cannot be posted twice). Same approvals required.

## Pages

`/content` calendar (day, week, month; unscheduled work beside it), `/content/new`, `/content/[id]` (editor, media, workflow,
schedule, comments, versions, approvals, publishing history, status history), `/content/ai` (Phase 12).
