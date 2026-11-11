# AI-assisted content generation (Phase 12)

A provider-independent service that drafts briefs, blog posts, titles, meta descriptions, captions, hashtags,
repurposed content, SEO recommendations and report summaries. **Everything it produces is an unverified draft.**

## Providers

`AI_PROVIDER` selects the adapter: `mock` (default, no key, deterministic placeholder JSON), `anthropic`, or
`openai_compatible` (OpenAI, OpenRouter, local Ollama/vLLM through `AI_BASE_URL`). The contract is `AiProvider` in
`packages/db/src/ai/provider.ts`; adapters in `packages/integrations/src/ai` use plain `fetch`. Keys exist only in the
worker environment. Prices are not built in: set `AI_PRICING_JSON` to get cost estimates, otherwise cost is "no price known".

## Flow

1. `requestGeneration` (web) checks `ai.use`, validates the request with the task's Zod schema, confirms the project,
   content item and sources belong to the client, enforces limits, snapshots the **input refs** (brand guideline id and
   version, approved source ids, synced figures) and queues an `ai_jobs` row. Same idempotency key = same job.
2. The worker (`apps/worker/src/jobs/ai-dispatch.ts`) claims jobs with `FOR UPDATE SKIP LOCKED`, reloads the material by
   id scoped to the job's own client, builds the prompt from a versioned template (`promptVersion`, e.g. `blog_draft@1`)
   and calls the provider with a timeout.
3. The reply is parsed and validated with the task's output schema. Invalid output is retried (up to 3 attempts, backoff
   computed in SQL); transient provider errors likewise; permanent ones fail with a safe message. Checks beyond shape:
   banned brand terms and channel length limits become warnings; a report summary that cites a figure that was not supplied
   is rejected.
4. Success stores `output` (`{result, warnings, unverified: true, disclaimer}`), tokens, estimated cost and an
   `ai_usage_records` row in one transaction.

## Safety rules

- The model sees only: the client's active brand guideline, the approved sources chosen (`ai_approved_sources`, added by
  `ai.manage`) and data the request names (open SEO issues, synced non-mock figures, the content being repurposed).
  Sources are wrapped as data in the prompt, with an instruction to ignore instructions inside them.
- Performance numbers and claims are never treated as facts: results list `claimsToVerify`, figures are labelled as synced
  readings, and the UI says so.
- Limits: per client per month (requests and optional estimated spend, `ai_limits` or the `AI_DEFAULT_*` values) and per
  person per hour.
- Output becomes content only through **Save as draft**: a new item (or a new version) with `author_kind = ai` and the job
  id, status `draft`. It must pass review and approval (see `docs/content-workflow.md`) before it can be scheduled.
- Every step is audited. Regeneration creates a new job pointing at the old one (`parent_job_id`) and passes the reviewer's
  feedback to the prompt; reviewer feedback and outcome are stored on the job.

## Tests

`packages/db/src/ai/ai.test.ts` uses the mock provider only. No credentials are needed anywhere in the test suite.
