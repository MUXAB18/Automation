import { z } from "zod";
import { requirePermission, type Actor } from "../access";
import { recordAudit } from "../audit";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import type { Prisma } from "../generated/client";
import { getUnscopedPrisma } from "../unsafe";
import type { SecretCipher } from "./integrations";

/**
 * Durable publishing jobs. The rules that prevent a duplicate or an unapproved post:
 *  - A job needs an APPROVED approval for exactly the content version (also enforced by a database trigger).
 *  - One job per (content version, integration account): the unique index stops a second post of the same version.
 *  - `request_sent_at` is stamped before the provider is called. A job that sent a request and got no clear
 *    answer is `needs_review`, never retried automatically, because the post may exist.
 *  - Only answers that mean "nothing was created" (rate limit, validation, permission) are retried or re-queued.
 */

type Tx = Prisma.TransactionClient;
const prismaClient = () => getUnscopedPrisma();
const MAX_AUTO_ATTEMPTS = 5;
/** A job "publishing" this long without finishing is assumed lost (worker crash). */
const STALE_PUBLISH_MS = 15 * 60_000;
const OK_PROVIDER_STATUSES = new Set(["published", "scheduled", "in_progress"]);

const requestSchema = z.object({
  integrationAccountId: z.uuid(),
  contentItemId: z.uuid(),
  targetAccountIds: z
    .array(z.string().min(1).max(200))
    .min(1, "Choose at least one social account")
    .max(20),
  scheduledFor: z.date().nullish(),
});

async function jobScope(jobId: string) {
  const job = await prismaClient().publishingJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      clientId: true,
      agencyId: true,
      status: true,
      contentItemId: true,
      requestSentAt: true,
      integrationAccountId: true,
    },
  });
  if (!job) throw new NotFoundError("Publishing job not found");
  return job;
}

/**
 * Move a content item along its lifecycle from the publishing pipeline, record the change in its history and, when it
 * ends (published or failed), tell the people responsible for it.
 */
async function setContentStatus(
  tx: Tx,
  contentItemId: string,
  status: "scheduled" | "publishing" | "published" | "failed",
  publishedAt?: Date,
) {
  const before = await tx.contentItem.findUniqueOrThrow({
    where: { id: contentItemId },
    select: { status: true, title: true, agencyId: true, clientId: true, createdById: true, assignedToId: true },
  });
  await tx.contentItem.update({
    where: { id: contentItemId },
    data: { status, ...(publishedAt ? { publishedAt } : {}) },
  });
  if (before.status !== status)
    await tx.contentStatusEvent.create({
      data: { agencyId: before.agencyId, clientId: before.clientId, contentItemId, fromStatus: before.status, toStatus: status, actorId: null, note: "Publishing pipeline" },
    });
  if (status === "published" || status === "failed")
    await notifyContentPeople(tx, contentItemId, status === "published" ? "publishing.succeeded" : "publishing.failed",
      status === "published" ? `Published: ${before.title}` : `Publishing failed: ${before.title}`,
      status === "published" ? undefined : "Open the content to see the error, then retry or publish it by hand.");
}

/** The requester of the publish and the people who own the content. */
export async function notifyContentPeople(tx: Tx, contentItemId: string, type: string, title: string, body?: string) {
  const item = await tx.contentItem.findUniqueOrThrow({
    where: { id: contentItemId },
    select: { agencyId: true, clientId: true, createdById: true, assignedToId: true, publishingJobs: { orderBy: { createdAt: "desc" }, take: 1, select: { requestedById: true } } },
  });
  const people = new Set([item.createdById, item.assignedToId, item.publishingJobs[0]?.requestedById].filter((x): x is string => !!x));
  if (people.size === 0) return;
  await tx.notification.createMany({
    data: [...people].map((userId) => ({ agencyId: item.agencyId, clientId: item.clientId, userId, type, title, body: body ?? null, entityType: "content_item", entityId: contentItemId })),
  });
}

// ---- Requesting ---------------------------------------------------------------------------------

export async function requestPublish(actor: Actor, raw: z.input<typeof requestSchema>) {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success)
    throw new ValidationError(
      Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), [i.message]])),
    );
  const input = parsed.data;
  const account = await prismaClient().integrationAccount.findUnique({
    where: { id: input.integrationAccountId },
    select: {
      id: true,
      clientId: true,
      agencyId: true,
      status: true,
      metadata: true,
      scopes: true,
    },
  });
  if (!account) throw new NotFoundError("Integration account not found");
  const ctx = await requirePermission(actor, account.clientId, "content.publish");
  if ((account.metadata as { mock?: boolean }).mock === true)
    throw new ConflictError(
      "A development mock account cannot publish. Connect the real account first",
    );
  if (account.status !== "active")
    throw new ConflictError("This integration account needs attention before it can publish");

  const item = await ctx.db.contentItem.findFirst({
    where: { id: input.contentItemId, clientId: account.clientId, archivedAt: null },
    select: { id: true, currentVersionId: true, status: true, requiresApproval: true, requiresClientApproval: true },
  });
  if (!item) throw new NotFoundError("Content not found");
  if (!item.currentVersionId) throw new ConflictError("This content has no version to publish");
  const approvedFor = (stage: "internal" | "client") =>
    ctx.db.contentApproval.findFirst({
      where: { contentItemId: item.id, contentVersionId: item.currentVersionId!, status: "approved", stage },
      orderBy: { decidedAt: "desc" },
      select: { id: true },
    });
  const internal = await approvedFor("internal");
  // CLAUDE.md rule 6: publishing needs an approval for exactly this version, and the client's too when it is required.
  if (!internal)
    throw new ConflictError("The current version has not been approved, so it cannot be published");
  const clientStage = item.requiresClientApproval ? await approvedFor("client") : null;
  if (item.requiresClientApproval && !clientStage)
    throw new ConflictError("The client has not approved the current version yet");
  const approval = clientStage ?? internal;
  const version = await ctx.db.contentVersion.findFirst({
    where: { id: item.currentVersionId },
    select: { body: true },
  });
  if (!version?.body.trim()) throw new ConflictError("The approved version has no text to publish");

  const targets = [...new Set(input.targetAccountIds)];
  const valid = await ctx.db.providerSocialAccount.findMany({
    where: { integrationAccountId: account.id, externalId: { in: targets }, isExpired: false },
    select: { externalId: true },
  });
  if (valid.length !== targets.length)
    throw new ValidationError({
      targetAccountIds: [
        "One of the social accounts is unknown or has expired. Sync the integration and reconnect it in GoHighLevel",
      ],
    });

  return prismaClient().$transaction(async (tx) => {
    let job: { id: string };
    const data = {
      contentApprovalId: approval.id,
      targetAccountIds: targets,
      status: (input.scheduledFor ? "scheduled" : "queued") as "scheduled" | "queued",
      scheduledFor: input.scheduledFor ?? null,
      requestedById: actor.userId,
    };
    // A cancelled job of the same version and account is reused (the unique index allows one job per pair), so a
    // post that was unscheduled can be scheduled again without ever having a second job for it.
    const prior = await tx.publishingJob.findUnique({
      where: { contentVersionId_integrationAccountId: { contentVersionId: item.currentVersionId!, integrationAccountId: account.id } },
      select: { id: true, status: true },
    });
    if (prior && prior.status !== "cancelled")
      throw new ConflictError("This version is already queued or published to this account");
    if (prior) {
      job = await tx.publishingJob.update({
        where: { id: prior.id },
        data: { ...data, attempts: 0, lastError: null, requestSentAt: null, startedAt: null, finishedAt: null },
        select: { id: true },
      });
    } else {
      try {
        job = await tx.publishingJob.create({
          data: { ...data, agencyId: account.agencyId, clientId: account.clientId, contentItemId: item.id, contentVersionId: item.currentVersionId!, integrationAccountId: account.id },
          select: { id: true },
        });
      } catch (error) {
        if ((error as { code?: string }).code === "P2002")
          throw new ConflictError("This version is already queued or published to this account");
        throw error;
      }
    }
    await setContentStatus(tx, item.id, "scheduled");
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: account.agencyId,
      clientId: account.clientId,
      action: "publishing.requested",
      entityType: "publishing_job",
      entityId: job.id,
      after: {
        contentItemId: item.id,
        versionId: item.currentVersionId,
        approvalId: approval.id,
        targets: targets.length,
      },
    });
    return job;
  });
}

export async function cancelPublish(actor: Actor, jobId: string) {
  const job = await jobScope(jobId);
  const ctx = await requirePermission(actor, job.clientId, "content.publish");
  await prismaClient().$transaction(async (tx) => {
    const done = await tx.publishingJob.updateMany({
      where: { id: jobId, status: { in: ["queued", "scheduled"] } },
      data: { status: "cancelled", finishedAt: new Date() },
    });
    if (done.count !== 1)
      throw new ConflictError("Only a job that has not started can be cancelled");
    await tx.contentItem.update({ where: { id: job.contentItemId }, data: { status: "approved" } });
    await tx.contentStatusEvent.create({ data: { agencyId: ctx.agencyId, clientId: job.clientId, contentItemId: job.contentItemId, fromStatus: "scheduled", toStatus: "approved", actorId: actor.userId, note: "Unscheduled" } });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: job.clientId,
      action: "publishing.cancelled",
      entityType: "publishing_job",
      entityId: jobId,
    });
  });
}

/** Put a FAILED job back in the queue. Refused when the provider may already have the post. */
export async function retryPublish(actor: Actor, jobId: string) {
  const job = await jobScope(jobId);
  const ctx = await requirePermission(actor, job.clientId, "content.publish");
  await prismaClient().$transaction(async (tx) => {
    const done = await tx.publishingJob.updateMany({
      where: { id: jobId, status: "failed", requestSentAt: null },
      data: {
        status: "queued",
        lastError: null,
        finishedAt: null,
        startedAt: null,
        scheduledFor: null,
      },
    });
    if (done.count !== 1)
      throw new ConflictError(
        job.status === "needs_review"
          ? "Check whether the post exists, then resolve the review first"
          : "Only a failed job that never reached the provider can be retried",
      );
    await setContentStatus(tx, job.contentItemId, "scheduled");
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: job.clientId,
      action: "publishing.retried",
      entityType: "publishing_job",
      entityId: jobId,
    });
  });
}

const resolution = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("posted"), externalPostId: z.string().trim().min(1).max(200) }),
  z.object({ outcome: z.literal("not_posted") }),
]);

/** A person checked the provider for a job in review and tells the platform what they found. */
export async function resolvePublishReview(
  actor: Actor,
  jobId: string,
  raw: z.input<typeof resolution>,
) {
  const input = resolution.parse(raw);
  const job = await jobScope(jobId);
  const ctx = await requirePermission(actor, job.clientId, "content.publish");
  await prismaClient().$transaction(async (tx) => {
    const current = await tx.publishingJob.findUniqueOrThrow({
      where: { id: jobId },
      select: { status: true },
    });
    if (current.status !== "needs_review")
      throw new ConflictError("This job is not waiting for review");
    if (input.outcome === "posted") {
      await recordSuccess(tx, jobId, input.externalPostId, "published");
    } else {
      // Confirmed absent: clearing request_sent_at makes a manual retry legitimate.
      await tx.publishingJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          requestSentAt: null,
          lastError: "Confirmed by a person: the post was not created",
          finishedAt: new Date(),
        },
      });
      await setContentStatus(tx, job.contentItemId, "failed");
    }
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: job.clientId,
      action: "publishing.review_resolved",
      entityType: "publishing_job",
      entityId: jobId,
      after: { outcome: input.outcome },
    });
  });
}

// ---- Worker -------------------------------------------------------------------------------------

export async function claimNextPublishingJob(): Promise<string | null> {
  // An approval withdrawn after queuing (rejected, cancelled, superseded) must stop the post.
  await prismaClient().$executeRaw`
    UPDATE publishing_jobs j SET status = 'failed', finished_at = now(), request_sent_at = NULL, updated_at = now(),
      last_error = 'The approval for this content was withdrawn before it was published'
    WHERE j.status IN ('queued', 'scheduled')
      AND NOT EXISTS (SELECT 1 FROM content_approvals a WHERE a.id = j.content_approval_id AND a.status = 'approved')`;
  const rows = await prismaClient().$queryRaw<{ id: string }[]>`
    UPDATE publishing_jobs SET status = 'publishing', started_at = now(), attempts = attempts + 1, updated_at = now()
    WHERE id = (
      SELECT id FROM publishing_jobs
      WHERE status IN ('queued', 'scheduled') AND (scheduled_for IS NULL OR scheduled_for <= now())
      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  return rows[0]?.id ?? null;
}

export type PublishExecution = {
  jobId: string;
  clientId: string;
  agencyId: string;
  accountId: string;
  providerKey: string;
  isMock: boolean;
  accountStatus: string;
  scopes: string[];
  attempts: number;
  text: string;
  targetAccountIds: string[];
  credentials: Record<string, string>;
};

export async function loadPublishExecution(
  jobId: string,
  cipher: SecretCipher,
): Promise<PublishExecution> {
  const job = await prismaClient().publishingJob.findUniqueOrThrow({
    where: { id: jobId },
    select: {
      id: true,
      clientId: true,
      agencyId: true,
      attempts: true,
      targetAccountIds: true,
      integrationAccountId: true,
      contentVersion: { select: { body: true } },
      integrationAccount: {
        select: {
          id: true,
          status: true,
          metadata: true,
          scopes: true,
          encryptedCredentials: true,
          integration: { select: { key: true } },
        },
      },
    },
  });
  const a = job.integrationAccount;
  const credentials = JSON.parse(
    cipher.decrypt(a.encryptedCredentials, `${job.clientId}:${a.integration.key}`),
  ) as Record<string, string>;
  return {
    jobId: job.id,
    clientId: job.clientId,
    agencyId: job.agencyId,
    accountId: a.id,
    providerKey: a.integration.key,
    isMock: (a.metadata as { mock?: boolean }).mock === true,
    accountStatus: a.status,
    scopes: a.scopes,
    attempts: job.attempts,
    text: job.contentVersion.body,
    targetAccountIds: job.targetAccountIds,
    credentials,
  };
}

/** Call immediately BEFORE the provider request. From here on, an unclear failure means "may exist". */
export async function markPublishRequestSent(jobId: string): Promise<void> {
  await prismaClient().publishingJob.update({
    where: { id: jobId },
    data: { requestSentAt: new Date() },
  });
}

async function recordSuccess(
  tx: Tx,
  jobId: string,
  externalPostId: string,
  providerStatus: string | null,
) {
  const job = await tx.publishingJob.findUniqueOrThrow({
    where: { id: jobId },
    select: { agencyId: true, clientId: true, contentItemId: true, integrationAccountId: true },
  });
  const now = new Date();
  // (integration account, provider post id) is unique: recording the same post twice cannot duplicate it.
  await tx.publishedPost.upsert({
    where: { publishingJobId_clientId: { publishingJobId: jobId, clientId: job.clientId } },
    create: {
      agencyId: job.agencyId,
      clientId: job.clientId,
      publishingJobId: jobId,
      contentItemId: job.contentItemId,
      integrationAccountId: job.integrationAccountId,
      externalPostId,
      publishedAt: now,
    },
    update: {},
  });
  await tx.publishingJob.update({
    where: { id: jobId },
    data: { status: "succeeded", finishedAt: now, lastError: null },
  });
  await setContentStatus(tx, job.contentItemId, "published", now);
  await recordAudit(tx, {
    actorUserId: null,
    agencyId: job.agencyId,
    clientId: job.clientId,
    action: "publishing.succeeded",
    entityType: "publishing_job",
    entityId: jobId,
    after: { providerStatus },
  });
}

export type PublishOutcome =
  | { kind: "accepted"; externalPostId: string; providerStatus: string | null }
  /** The provider clearly refused; nothing was created. `retryAfterMs` set = worth re-queuing. */
  | { kind: "rejected"; message: string; retryAfterMs?: number }
  /** The request may have reached the provider. */
  | { kind: "unknown"; message: string };

export async function finishPublishingJob(jobId: string, outcome: PublishOutcome): Promise<void> {
  await prismaClient().$transaction(async (tx) => {
    const job = await tx.publishingJob.findUniqueOrThrow({
      where: { id: jobId },
      select: { status: true, attempts: true, contentItemId: true, agencyId: true, clientId: true },
    });
    if (job.status !== "publishing") return;
    const audit = (action: string, after: Prisma.InputJsonObject) =>
      recordAudit(tx, {
        actorUserId: null,
        agencyId: job.agencyId,
        clientId: job.clientId,
        action,
        entityType: "publishing_job",
        entityId: jobId,
        after,
      });

    if (outcome.kind === "accepted") {
      const status = outcome.providerStatus;
      if (status && OK_PROVIDER_STATUSES.has(status))
        return recordSuccess(tx, jobId, outcome.externalPostId, status);
      // We have an id but the provider does not call it published/scheduled: do not claim success.
      await tx.publishingJob.update({
        where: { id: jobId },
        data: {
          status: "needs_review",
          lastError: `The provider created the post (id ${outcome.externalPostId.slice(0, 60)}) but reported status "${(status ?? "unknown").slice(0, 40)}". Check it in GoHighLevel`,
        },
      });
      await notifyContentPeople(tx, job.contentItemId, "publishing.needs_review", "A post needs a manual check", "The provider did not confirm the post. Check it before trying again.");
      return audit("publishing.needs_review", { reason: "status", postId: outcome.externalPostId });
    }
    if (outcome.kind === "unknown") {
      await tx.publishingJob.update({
        where: { id: jobId },
        data: { status: "needs_review", lastError: outcome.message.slice(0, 500) },
      });
      await notifyContentPeople(tx, job.contentItemId, "publishing.needs_review", "A post needs a manual check", "We could not tell whether the post was created. Check the account before trying again.");
      return audit("publishing.needs_review", { reason: "outcome_unknown" });
    }
    // Rejected: nothing was created, so the request mark is cleared and a retry is legitimate.
    if (outcome.retryAfterMs !== undefined && job.attempts < MAX_AUTO_ATTEMPTS) {
      // The delay is computed by the database, the same clock the claim query compares against.
      const seconds = Math.max(outcome.retryAfterMs, 5_000) / 1000;
      await tx.$executeRaw`
        UPDATE publishing_jobs SET status = 'scheduled', request_sent_at = NULL, updated_at = now(),
          scheduled_for = now() + make_interval(secs => ${seconds}), last_error = ${outcome.message.slice(0, 500)}
        WHERE id = ${jobId}`;
      return;
    }
    await tx.publishingJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        requestSentAt: null,
        finishedAt: new Date(),
        lastError: outcome.message.slice(0, 500),
      },
    });
    await setContentStatus(tx, job.contentItemId, "failed");
    return audit("publishing.failed", { message: outcome.message.slice(0, 200) });
  });
}

/** Jobs stuck "publishing": requeue if nothing was sent, otherwise they need a person. */
export async function reapStalePublishingJobs(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_PUBLISH_MS);
  const stale = await prismaClient().publishingJob.findMany({
    where: { status: "publishing", startedAt: { lt: cutoff } },
    select: { id: true, requestSentAt: true },
  });
  for (const job of stale) {
    await prismaClient().publishingJob.update({
      where: { id: job.id },
      data: job.requestSentAt
        ? {
            status: "needs_review",
            lastError:
              "The worker stopped after sending the request. Check whether the post exists",
          }
        : { status: "queued", startedAt: null },
    });
  }
  return stale.length;
}

// ---- Reads for the UI ---------------------------------------------------------------------------

export async function listPublishingJobs(actor: Actor, accountId: string) {
  const account = await prismaClient().integrationAccount.findUnique({
    where: { id: accountId },
    select: { clientId: true },
  });
  if (!account) throw new NotFoundError("Integration account not found");
  const ctx = await requirePermission(actor, account.clientId, "integration.view");
  const canPublish =
    (await requirePermission(actor, account.clientId, "content.publish").catch(() => null)) !==
    null;
  const jobs = await ctx.db.publishingJob.findMany({
    where: { integrationAccountId: accountId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      status: true,
      attempts: true,
      lastError: true,
      scheduledFor: true,
      finishedAt: true,
      createdAt: true,
      targetAccountIds: true,
      requestSentAt: true,
      contentItem: { select: { title: true } },
    },
  });
  return { canPublish, jobs: jobs.map((j) => ({ ...j, title: j.contentItem.title })) };
}

/** Approved content (current version approved) not yet queued for this account. */
export async function listPublishable(actor: Actor, accountId: string) {
  const account = await prismaClient().integrationAccount.findUnique({
    where: { id: accountId },
    select: { clientId: true },
  });
  if (!account) throw new NotFoundError("Integration account not found");
  const ctx = await requirePermission(actor, account.clientId, "content.publish");
  const items = await ctx.db.contentItem.findMany({
    where: {
      clientId: account.clientId,
      archivedAt: null,
      status: "approved",
      currentVersionId: { not: null },
      contentApprovals: { some: { status: "approved" } },
      publishingJobs: { none: { integrationAccountId: accountId } },
    },
    orderBy: { updatedAt: "desc" },
    take: 25,
    select: {
      id: true,
      title: true,
      channel: true,
      currentVersionId: true,
      contentApprovals: { where: { status: "approved" }, select: { contentVersionId: true } },
    },
  });
  // Only items whose CURRENT version is the approved one.
  return items
    .filter((i) => i.contentApprovals.some((a) => a.contentVersionId === i.currentVersionId))
    .map(({ id, title, channel }) => ({ id, title, channel }));
}
