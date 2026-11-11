import { z } from "zod";
import { recordAudit } from "../audit";
import type { Prisma } from "../generated/client";
import { getUnscopedPrisma } from "../unsafe";
import { loadPromptContext, type InputRefs } from "./context";
import { estimateCostMicros } from "./pricing";
import type { AiProvider, AiRuntimeConfig } from "./provider";
import {
  CHANNEL_LIMITS,
  buildPrompt,
  inputSchemas,
  outputSchemas,
  type AiTask,
  type Channel,
} from "./templates";

const prisma = () => getUnscopedPrisma();
export const MAX_AI_ATTEMPTS = 3;
const RETRY_BASE_SECONDS = 30;
const STALE_MS = 15 * 60_000;
const CALL_TIMEOUT_MS = 120_000;

export const AI_DISCLAIMER =
  "AI-generated draft. Claims and figures in it are not verified facts. A person must review and approve it before use.";

/** Claim the oldest waiting job whose retry time has come (safe with several workers). */
export async function claimNextAiJob(): Promise<string | null> {
  const rows = await prisma().$queryRaw<{ id: string }[]>`
    UPDATE ai_jobs SET status = 'running', started_at = now()
    WHERE id = (SELECT id FROM ai_jobs WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= now())
                ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id`;
  return rows[0]?.id ?? null;
}

/** A job stuck "running" (worker crash) goes back to the queue, or fails once its attempts are used up. */
export async function reapStaleAiJobs(now = new Date()): Promise<number> {
  const stale = await prisma().aiJob.findMany({
    where: { status: "running", startedAt: { lt: new Date(now.getTime() - STALE_MS) } },
    select: { id: true, attempt: true },
  });
  for (const j of stale)
    await retryOrFail(j.id, j.attempt, "The worker stopped while generating.", true);
  return stale.length;
}

async function retryOrFail(jobId: string, attempt: number, error: string, retryable: boolean) {
  if (retryable && attempt < MAX_AI_ATTEMPTS) {
    // The delay is computed by the database, the same clock the claim query compares against.
    const seconds = RETRY_BASE_SECONDS * 2 ** (attempt - 1);
    await prisma()
      .$executeRaw`UPDATE ai_jobs SET status = 'queued', attempt = attempt + 1, error = ${error.slice(0, 400)}, started_at = NULL,
      next_attempt_at = now() + make_interval(secs => ${seconds}) WHERE id = ${jobId} AND status = 'running'`;
    return;
  }
  await prisma().aiJob.updateMany({
    where: { id: jobId, status: "running" },
    data: { status: "failed", error: error.slice(0, 400), finishedAt: new Date() },
  });
}

class OutputError extends Error {}

/** The model's reply -> a JSON value. Models sometimes wrap JSON in a code fence or add a sentence. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new OutputError("The AI answer was not a JSON document.");
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new OutputError("The AI answer was not valid JSON.");
  }
}

/** Checks that need the context, not just the shape. Problems that make the output unusable throw; the rest are warnings. */
function review(
  task: AiTask,
  input: Record<string, unknown>,
  result: Record<string, unknown>,
  ctx: Awaited<ReturnType<typeof loadPromptContext>>,
  refs: InputRefs,
): string[] {
  const warnings: string[] = [];
  const banned = ctx.brand?.bannedTerms ?? [];
  const haystack = JSON.stringify(result).toLowerCase();
  for (const term of banned)
    if (term && haystack.includes(term.toLowerCase()))
      warnings.push(`Contains a banned term from the brand guideline: "${term}".`);
  if (task === "social_captions") {
    const limit = CHANNEL_LIMITS[(input.channel as Channel) ?? "linkedin"];
    for (const c of (result.captions as { text: string }[]) ?? [])
      if (c.text.length > limit)
        warnings.push(`A caption is longer than the ${limit}-character limit for this channel.`);
  }
  if (task === "seo_titles")
    for (const s of (result.suggestions as { title: string }[]) ?? [])
      if (s.title.length > 70)
        warnings.push(
          `A title is ${s.title.length} characters; search results usually cut titles near 60-70.`,
        );
  if (task === "meta_descriptions")
    for (const s of (result.suggestions as { text: string }[]) ?? [])
      if (s.text.length > 160)
        warnings.push(
          `A description is ${s.text.length} characters; search results usually cut it near 160.`,
        );
  if (task === "report_summary") {
    // A number the model cites must be one we supplied. Anything else is an invented performance figure.
    const supplied = new Map((refs.figures ?? []).map((f) => [f.label, f.value]));
    for (const f of (result.figuresUsed as { label: string; value: number | string }[]) ?? []) {
      if (supplied.get(f.label) !== Number(f.value))
        throw new OutputError(
          `The summary cites a figure ("${f.label}") that was not in the supplied data.`,
        );
    }
  }
  return warnings;
}

/**
 * Run one claimed job. Never throws. Valid output is stored with its token usage and estimated cost and stays a
 * draft: nothing here creates or publishes content.
 */
export async function executeAiJob(
  jobId: string,
  provider: AiProvider,
  config: Pick<AiRuntimeConfig, "pricing">,
): Promise<void> {
  const job = await prisma().aiJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "running") return;
  const task = job.task as AiTask;
  try {
    const refs = job.inputRefs as unknown as InputRefs;
    const raw = job.input as Record<string, unknown>;
    const feedback = typeof raw._feedback === "string" ? raw._feedback : null;
    const input = inputSchemas[task].parse(
      Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith("_"))),
    ) as Record<string, unknown>;
    // Re-load the material by id, scoped to the job's own client: a job can never read another client's data.
    const ctx = await loadPromptContext(
      { agencyId: job.agencyId, clientId: job.clientId, projectId: job.projectId },
      refs,
      input,
    );
    const { system, prompt } = buildPrompt(task, input, ctx, feedback);

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), CALL_TIMEOUT_MS);
    let reply;
    try {
      reply = await provider.generate({
        model: job.model,
        system,
        prompt,
        maxOutputTokens: task === "blog_draft" ? 6000 : 3000,
        task,
        meta: input,
        signal: abort.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const parsed = outputSchemas[task].safeParse(extractJson(reply.text));
    if (!parsed.success)
      throw new OutputError(
        `The AI answer did not match the expected format (${parsed.error.issues[0]?.path.join(".") || "root"}).`,
      );
    const warnings = review(task, input, parsed.data as Record<string, unknown>, ctx, refs);
    const cost = estimateCostMicros(
      job.model,
      reply.inputTokens,
      reply.outputTokens,
      config.pricing,
    );

    await prisma().$transaction(async (tx) => {
      const done = await tx.aiJob.updateMany({
        where: { id: jobId, status: "running" },
        data: {
          status: "succeeded",
          finishedAt: new Date(),
          error: null,
          nextAttemptAt: null,
          output: {
            result: parsed.data,
            warnings,
            unverified: true,
            disclaimer: AI_DISCLAIMER,
          } as Prisma.InputJsonObject,
          inputTokens: reply.inputTokens ?? null,
          outputTokens: reply.outputTokens ?? null,
          estimatedCostMicros: cost,
        },
      });
      if (done.count === 0) return; // cancelled or taken over meanwhile
      if (reply.inputTokens != null && reply.outputTokens != null)
        await tx.aiUsageRecord.create({
          data: {
            agencyId: job.agencyId,
            clientId: job.clientId,
            aiJobId: job.id,
            provider: job.provider,
            model: job.model,
            inputTokens: reply.inputTokens,
            outputTokens: reply.outputTokens,
            costMicros: cost ?? 0n,
          },
        });
      await recordAudit(tx, {
        actorUserId: null,
        agencyId: job.agencyId,
        clientId: job.clientId,
        action: "ai.generation_succeeded",
        entityType: "ai_job",
        entityId: job.id,
        after: { task, warnings: warnings.length },
      });
    });
  } catch (error) {
    const e = error as { retryable?: boolean; safeMessage?: string };
    if (error instanceof OutputError) return retryOrFail(jobId, job.attempt, error.message, true);
    if (error instanceof z.ZodError)
      return retryOrFail(jobId, job.attempt, "The request is no longer valid.", false);
    if (typeof e.safeMessage === "string")
      return retryOrFail(jobId, job.attempt, e.safeMessage, e.retryable === true);
    if ((error as Error).name === "AbortError")
      return retryOrFail(jobId, job.attempt, "The AI provider took too long to answer.", true);
    return retryOrFail(jobId, job.attempt, "An unexpected error occurred while generating.", false);
  }
}
