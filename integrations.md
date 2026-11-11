# Integrations

Each integration is a typed client in `packages/integrations/<name>` behind an interface, so it
can be mocked in tests and swapped later. Credentials per customer live in `social_accounts` (or a
similar table), encrypted.

| Integration | Folder | Purpose | Auth | Used by |
| --- | --- | --- | --- | --- |
| Claude API | claude | Recommendations, drafts, captions, hashtags | API key (env) | content-generate, recommendations |
| Google Search Console | google-search-console | Queries, clicks, impressions, positions, indexing | OAuth per customer | analytics-sync, rank-check |
| Google Analytics 4 | ga4 | Sessions, users, conversions | OAuth per customer | analytics-sync |
| Meta (Facebook/Instagram) | meta | Publish posts, read engagement | OAuth per customer | publish-post, analytics-sync |
| LinkedIn | linkedin | Publish posts, read engagement | OAuth per customer | publish-post, analytics-sync |
| Email | email | Send reports and alerts | API key (env) | report-15day, alert-notify |

## Claude wrapper rules

- Single entry point; no other code calls the API directly.
- Prompt templates versioned in code; brand voice and keywords injected from customer data.
- Output requested as JSON and validated with Zod; retry/repair on invalid output.
- Log model, tokens and cost per customer and per job.
- Never let model output trigger actions without the approval flow.

## Email provider interface

```ts
interface Mailer {
  send(message: { to: string[]; subject: string; html: string; text?: string;
                  attachments?: { filename: string; content: Buffer }[] }): Promise<{ id: string }>;
}
```

Providers (Resend, Brevo, SES) implement it; chosen by env.

## Rank data source (open)

Options: Search Console average positions (free, delayed, aggregated) vs. a SERP API
(exact daily positions, paid). Decision tracked in `decisions.md`.

## Client requirements

- Typed request/response with Zod validation of external data.
- Timeouts, retries with backoff, rate-limit awareness.
- Token refresh handled in the client; refreshed tokens re-encrypted and saved.
- Errors normalized into a small set of typed error classes.
- Test with recorded fixtures; no live calls in unit tests.
