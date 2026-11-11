import { z } from "zod";
import { clientIdsWith, forClients, getAccessMap, requirePermission, type Actor } from "../access";
import { recordAudit } from "../audit";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import type { Prisma } from "../generated/client";
import { PAGE_SIZE, clampPage, paged } from "../services/paging";
import { getUnscopedPrisma } from "../unsafe";
import { resolveRefs, type InputRefs } from "./context";
import type { AiRuntimeConfig } from "./provider";
import { AI_TASKS, inputSchemas, promptVersion, type AiTask } from "./templates";

const prisma = () => getUnscopedPrisma();
const isUnique = (e: unknown) => (e as { code?: string }).code === "P2002";

const KIND_BY_TASK: Record<
  AiTask,
  "generate_content" | "rewrite" | "summarize" | "seo_analysis" | "report_summary"
> = {
  content_brief: "generate_content",
  blog_draft: "generate_content",
  seo_titles: "seo_analysis",
  meta_descriptions: "seo_analysis",
  social_captions: "generate_content",
  hashtags: "generate_content",
  repurpose: "rewrite",
  seo_recommendations: "seo_analysis",
  report_summary: "report_summary",
};

export const monthStart = (now = new Date()) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

// ---- Limits --------------------------------------------------------------------------------------------------------

export async function getAiUsage(clientId: string, config: AiRuntimeConfig, now = new Date()) {
  const limit = await prisma().aiLimit.findUnique({ where: { clientId } });
  const from = monthStart(now);
  const [requests, cost] = await Promise.all([
    prisma().aiJob.count({
      where: { clientId, createdAt: { gte: from }, status: { not: "cancelled" } },
    }),
    prisma().aiUsageRecord.aggregate({
      where: { clientId, occurredAt: { gte: from } },
      _sum: { costMicros: true },
    }),
  ]);
  return {
    requests,
    costMicros: cost._sum.costMicros ?? 0n,
    maxRequests: limit?.monthlyRequests ?? config.defaultMonthlyRequests,
    maxCostMicros: limit
      ? limit.monthlyCostMicros
      : BigInt(Math.round(config.defaultMonthlyCostUsd * 1_000_000)),
  };
}

async function assertWithinLimits(
  actor: Actor,
  agencyId: string,
  clientId: string,
  config: AiRuntimeConfig,
  now: Date,
) {
  const usage = await getAiUsage(clientId, config, now);
  if (usage.requests >= usage.maxRequests)
    throw new ConflictError(
      "This client has used all its AI requests for the month. An admin can raise the limit.",
    );
  if (usage.maxCostMicros > 0n && usage.costMicros >= usage.maxCostMicros)
    throw new ConflictError(
      "This client has reached its monthly AI spending limit. An admin can raise the limit.",
    );
  const recent = await prisma().aiJob.count({
    where: {
      requestedById: actor.userId,
      agencyId,
      createdAt: { gte: new Date(now.getTime() - 3_600_000) },
    },
  });
  if (recent >= config.perUserHourly)
    throw new ConflictError("You have made many AI requests in the last hour. Try again later.");
}

export async function setAiLimit(
  actor: Actor,
  clientId: string,
  input: { monthlyRequests: number; monthlyCostUsd: number },
) {
  const ctx = await requirePermission(actor, clientId, "ai.manage");
  const parsed = z
    .object({
      monthlyRequests: z.coerce.number().int().min(0).max(1_000_000),
      monthlyCostUsd: z.coerce.number().min(0).max(1_000_000),
    })
    .safeParse(input);
  if (!parsed.success)
    throw new ValidationError({ monthlyRequests: ["Enter whole numbers, zero or more"] });
  const data = {
    monthlyRequests: parsed.data.monthlyRequests,
    monthlyCostMicros: BigInt(Math.round(parsed.data.monthlyCostUsd * 1_000_000)),
    updatedById: actor.userId,
  };
  await prisma().$transaction(async (tx) => {
    await tx.aiLimit.upsert({
      where: { clientId },
      update: data,
      create: { ...data, agencyId: ctx.agencyId, clientId },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId,
      action: "ai.limit_set",
      entityType: "client",
      entityId: clientId,
      after: { monthlyRequests: data.monthlyRequests },
    });
  });
}

// ---- Approved sources -----------------------------------------------------------------------------------------------

export async function listApprovedSources(actor: Actor, clientId: string) {
  const ctx = await requirePermission(actor, clientId, "ai.use");
  return ctx.db.aiApprovedSource.findMany({
    where: { archivedAt: null },
    orderBy: { approvedAt: "desc" },
    select: {
      id: true,
      title: true,
      body: true,
      sourceUrl: true,
      projectId: true,
      approvedAt: true,
      approvedBy: { select: { name: true } },
    },
  });
}

const sourceSchema = z.object({
  title: z.string().trim().min(1, "Give the source a title").max(200),
  body: z.string().trim().min(1, "Paste the source text").max(20_000),
  sourceUrl: z
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  projectId: z.uuid().nullish(),
});

export async function addApprovedSource(
  actor: Actor,
  clientId: string,
  raw: z.input<typeof sourceSchema>,
) {
  const ctx = await requirePermission(actor, clientId, "ai.manage");
  const parsed = sourceSchema.safeParse(raw);
  if (!parsed.success)
    throw new ValidationError(
      Object.fromEntries(parsed.error.issues.map((i) => [i.path.join(".") || "form", [i.message]])),
    );
  if (
    parsed.data.projectId &&
    !(await prisma().project.findFirst({
      where: { id: parsed.data.projectId, clientId },
      select: { id: true },
    }))
  )
    throw new ValidationError({ projectId: ["Choose one of this client's projects"] });
  return prisma().$transaction(async (tx) => {
    const row = await tx.aiApprovedSource.create({
      data: {
        ...parsed.data,
        projectId: parsed.data.projectId ?? null,
        agencyId: ctx.agencyId,
        clientId,
        approvedById: actor.userId,
      },
      select: { id: true },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId,
      action: "ai.source_approved",
      entityType: "ai_approved_source",
      entityId: row.id,
      after: { title: parsed.data.title },
    });
    return row;
  });
}

export async function archiveApprovedSource(actor: Actor, sourceId: string) {
  const found = await prisma().aiApprovedSource.findUnique({
    where: { id: sourceId },
    select: { clientId: true },
  });
  if (!found) throw new NotFoundError("Source not found");
  const ctx = await requirePermission(actor, found.clientId, "ai.manage");
  await prisma().$transaction(async (tx) => {
    await tx.aiApprovedSource.update({ where: { id: sourceId }, data: { archivedAt: new Date() } });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: found.clientId,
      action: "ai.source_archived",
      entityType: "ai_approved_source",
      entityId: sourceId,
    });
  });
}

// ---- Requesting, regenerating, reviewing -------------------------------------------------------------------------------

export type GenerationRequest = {
  clientId: string;
  projectId?: string | null;
  contentItemId?: string | null;
  task: string;
  input: unknown;
  sourceIds?: string[];
  /** A nonce from the form: submitting twice (double click, retry) returns the same job. */
  idempotencyKey?: string;
};

function parseInput(task: string, input: unknown) {
  if (!(AI_TASKS as readonly string[]).includes(task))
    throw new ValidationError({ task: ["Choose a type of content to generate"] });
  const parsed = inputSchemas[task as AiTask].safeParse(input);
  if (!parsed.success)
    throw new ValidationError(
      Object.fromEntries(parsed.error.issues.map((i) => [i.path.join(".") || "form", [i.message]])),
    );
  return { task: task as AiTask, data: parsed.data as Record<string, unknown> };
}

export async function requestGeneration(
  actor: Actor,
  req: GenerationRequest,
  config: AiRuntimeConfig,
  extra: { parentJobId?: string; feedback?: string } = {},
  now = new Date(),
) {
  const ctx = await requirePermission(actor, req.clientId, "ai.use");
  const { task, data } = parseInput(req.task, req.input);
  if (
    req.projectId &&
    !(await prisma().project.findFirst({
      where: { id: req.projectId, clientId: req.clientId, archivedAt: null },
      select: { id: true },
    }))
  )
    throw new ValidationError({ projectId: ["Choose one of this client's projects"] });
  if (
    req.contentItemId &&
    !(await prisma().contentItem.findFirst({
      where: { id: req.contentItemId, clientId: req.clientId },
      select: { id: true },
    }))
  )
    throw new NotFoundError("Content not found");

  if (req.idempotencyKey) {
    const existing = await prisma().aiJob.findUnique({
      where: {
        clientId_idempotencyKey: { clientId: req.clientId, idempotencyKey: req.idempotencyKey },
      },
      select: { id: true },
    });
    if (existing) return existing;
  }
  await assertWithinLimits(actor, ctx.agencyId, req.clientId, config, now);
  const refs = await resolveRefs(
    { agencyId: ctx.agencyId, clientId: req.clientId, projectId: req.projectId },
    task,
    data,
    req.sourceIds,
  );
  const stored = { ...data, ...(extra.feedback ? { _feedback: extra.feedback } : {}) };

  try {
    return await prisma().$transaction(async (tx) => {
      const job = await tx.aiJob.create({
        data: {
          agencyId: ctx.agencyId,
          clientId: req.clientId,
          projectId: req.projectId ?? null,
          contentItemId: req.contentItemId ?? null,
          parentJobId: extra.parentJobId ?? null,
          kind: KIND_BY_TASK[task],
          task,
          provider: config.provider,
          model: config.model,
          promptVersion: promptVersion(task),
          input: stored as Prisma.InputJsonObject,
          inputRefs: refs as unknown as Prisma.InputJsonObject,
          idempotencyKey: req.idempotencyKey ?? null,
          requestedById: actor.userId,
        },
        select: { id: true },
      });
      await recordAudit(tx, {
        actorUserId: actor.userId,
        agencyId: ctx.agencyId,
        clientId: req.clientId,
        action: "ai.generation_requested",
        entityType: "ai_job",
        entityId: job.id,
        after: {
          task,
          provider: config.provider,
          model: config.model,
          sources: refs.sourceIds.length,
        },
      });
      return job;
    });
  } catch (error) {
    if (isUnique(error) && req.idempotencyKey)
      return prisma().aiJob.findUniqueOrThrow({
        where: {
          clientId_idempotencyKey: { clientId: req.clientId, idempotencyKey: req.idempotencyKey },
        },
        select: { id: true },
      });
    throw error;
  }
}

async function loadJob(jobId: string) {
  const job = await prisma().aiJob.findUnique({ where: { id: jobId } });
  if (!job) throw new NotFoundError("Generation not found");
  return job;
}

/** Ask again, optionally with new settings and with the reviewer's feedback. The earlier job is kept. */
export async function regenerate(
  actor: Actor,
  jobId: string,
  config: AiRuntimeConfig,
  opts: { input?: unknown; feedback?: string } = {},
) {
  const old = await loadJob(jobId);
  await requirePermission(actor, old.clientId, "ai.use");
  const input =
    opts.input ??
    Object.fromEntries(
      Object.entries(old.input as Record<string, unknown>).filter(([k]) => !k.startsWith("_")),
    );
  const refs = old.inputRefs as unknown as InputRefs;
  return requestGeneration(
    actor,
    {
      clientId: old.clientId,
      projectId: old.projectId,
      contentItemId: old.contentItemId,
      task: old.task,
      input,
      sourceIds: refs.sourceIds,
    },
    config,
    { parentJobId: old.id, feedback: opts.feedback ?? old.reviewerFeedback ?? undefined },
  );
}

export async function cancelAiJob(actor: Actor, jobId: string) {
  const job = await loadJob(jobId);
  const ctx = await requirePermission(actor, job.clientId, "ai.use");
  const done = await prisma().aiJob.updateMany({
    where: { id: jobId, status: "queued" },
    data: { status: "cancelled", finishedAt: new Date() },
  });
  if (done.count === 0) throw new ConflictError("Only a waiting request can be cancelled");
  await prisma().$transaction((tx) =>
    recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: job.clientId,
      action: "ai.generation_cancelled",
      entityType: "ai_job",
      entityId: jobId,
    }),
  );
}

export async function reviewAiJob(
  actor: Actor,
  jobId: string,
  input: { outcome: "accepted" | "needs_work" | "rejected"; feedback?: string },
) {
  const job = await loadJob(jobId);
  const ctx = await requirePermission(actor, job.clientId, "ai.use");
  if (job.status !== "succeeded")
    throw new ConflictError("Only a finished generation can be reviewed");
  if (!["accepted", "needs_work", "rejected"].includes(input.outcome))
    throw new ValidationError({ outcome: ["Choose an outcome"] });
  const feedback = input.feedback?.trim().slice(0, 2000) || null;
  if (input.outcome !== "accepted" && !feedback)
    throw new ValidationError({ feedback: ["Say what needs to change"] });
  await prisma().$transaction(async (tx) => {
    await tx.aiJob.update({
      where: { id: jobId },
      data: {
        reviewOutcome: input.outcome,
        reviewerFeedback: feedback,
        reviewedById: actor.userId,
        reviewedAt: new Date(),
      },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: job.clientId,
      action: "ai.generation_reviewed",
      entityType: "ai_job",
      entityId: jobId,
      after: { outcome: input.outcome },
    });
  });
}

// ---- Reading ------------------------------------------------------------------------------------------------------

const jobSelect = {
  id: true,
  clientId: true,
  projectId: true,
  contentItemId: true,
  parentJobId: true,
  task: true,
  kind: true,
  status: true,
  provider: true,
  model: true,
  promptVersion: true,
  attempt: true,
  error: true,
  inputTokens: true,
  outputTokens: true,
  estimatedCostMicros: true,
  reviewOutcome: true,
  reviewerFeedback: true,
  reviewedAt: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
  requestedBy: { select: { name: true } },
  client: { select: { name: true } },
} satisfies Prisma.AiJobSelect;

export async function listAiJobs(
  actor: Actor,
  f: { clientId?: string; task?: string; status?: string; page?: number } = {},
) {
  const map = await getAccessMap(actor);
  const allowed = clientIdsWith(map, "ai.use");
  const ids = f.clientId ? allowed.filter((c) => c === f.clientId) : allowed;
  const page = clampPage(f.page);
  if (ids.length === 0) return paged([], 0, page);
  const where: Prisma.AiJobWhereInput = {
    clientId: { in: ids },
    ...((AI_TASKS as readonly string[]).includes(f.task ?? "") ? { task: f.task } : {}),
    ...(f.status ? { status: f.status as never } : {}),
  };
  const db = forClients(ids);
  const [rows, total] = await Promise.all([
    db.aiJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: jobSelect,
    }),
    db.aiJob.count({ where }),
  ]);
  return paged(rows, total, page);
}

export async function getAiJob(actor: Actor, jobId: string) {
  const found = await prisma().aiJob.findUnique({
    where: { id: jobId },
    select: { clientId: true },
  });
  if (!found) throw new NotFoundError("Generation not found");
  const ctx = await requirePermission(actor, found.clientId, "ai.use");
  return ctx.db.aiJob.findFirstOrThrow({
    where: { id: jobId },
    select: {
      ...jobSelect,
      input: true,
      inputRefs: true,
      output: true,
      project: { select: { name: true } },
      contentVersions: { select: { id: true, versionNo: true, contentItemId: true } },
      regenerations: {
        select: { id: true, status: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}
