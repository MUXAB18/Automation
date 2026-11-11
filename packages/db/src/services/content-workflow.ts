import { z } from "zod";
import {
  requirePermission,
  listUsersWithPermission,
  getAccessMap,
  clientIdsWith,
  forClients,
  type Actor,
} from "../access";
import { recordAudit } from "../audit";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import type { Prisma } from "../generated/client";
import { CHANNELS, type Channel } from "../ai/templates";
import { getUnscopedPrisma } from "../unsafe";
import { zonedDay } from "../time-zone";
import { cancelPublish, requestPublish } from "./publishing";
import { parseSchedule, recordStatus } from "./content";
import {
  CHANNEL_RULES,
  IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  VIDEO_TYPES,
  directPlatformsFor,
  validateContent,
  type ValidationResult,
} from "./content-validation";

/**
 * The content lifecycle: Idea -> Brief -> Draft -> Internal review -> Client approval (when required) -> Approved ->
 * Scheduled -> Publishing -> Published, with Changes requested, Rejected, Publishing failed and Cancelled on the side.
 * Every move is checked here, written to the status history and audited in the same transaction.
 */

const prisma = () => getUnscopedPrisma();
type Tx = Prisma.TransactionClient;

/** Allowed manual moves. Moves made by the publishing pipeline (publishing, published, failed) are in publishing.ts. */
export const CONTENT_TRANSITIONS: Record<string, string[]> = {
  idea: ["brief", "draft", "cancelled"],
  brief: ["draft", "cancelled"],
  draft: ["in_review", "cancelled"],
  in_review: ["approved", "client_approval", "changes_requested", "rejected", "draft"],
  client_approval: ["approved", "changes_requested", "rejected", "draft"],
  changes_requested: ["in_review", "draft", "cancelled"],
  rejected: ["draft", "cancelled"],
  approved: ["scheduled", "draft", "cancelled"],
  scheduled: ["approved", "publishing", "cancelled"],
  publishing: ["published", "failed"],
  failed: ["scheduled", "approved", "cancelled"],
  published: [],
  cancelled: ["draft"],
  archived: [],
};
export const canMove = (from: string, to: string) =>
  CONTENT_TRANSITIONS[from]?.includes(to) ?? false;
function assertMove(from: string, to: string) {
  if (!canMove(from, to))
    throw new ConflictError(
      `Content that is "${from.replace(/_/g, " ")}" cannot move to "${to.replace(/_/g, " ")}".`,
    );
}

async function loadItem(contentItemId: string) {
  const item = await prisma().contentItem.findUnique({
    where: { id: contentItemId },
    select: {
      id: true,
      agencyId: true,
      clientId: true,
      title: true,
      channel: true,
      status: true,
      archivedAt: true,
      requiresClientApproval: true,
      scheduledFor: true,
      currentVersionId: true,
      createdById: true,
      assignedToId: true,
      currentVersion: {
        select: { id: true, body: true, metadata: true, createdById: true, versionNo: true },
      },
    },
  });
  if (!item || item.archivedAt) throw new NotFoundError("Content not found");
  return item;
}
type Item = Awaited<ReturnType<typeof loadItem>>;

async function clientUserIds(clientId: string): Promise<Set<string>> {
  const rows = await prisma().clientMembership.findMany({
    where: { clientId, status: "active", roles: { some: { role: { key: "client" } } } },
    select: { userId: true },
  });
  return new Set(rows.map((r) => r.userId));
}

async function notify(
  tx: Tx,
  item: Pick<Item, "agencyId" | "clientId" | "id">,
  userIds: Iterable<string>,
  exclude: string,
  type: string,
  title: string,
  body?: string,
) {
  const ids = [...new Set(userIds)].filter((u) => u !== exclude);
  if (ids.length === 0) return;
  await tx.notification.createMany({
    data: ids.map((userId) => ({
      agencyId: item.agencyId,
      clientId: item.clientId,
      userId,
      type,
      title,
      body: body ?? null,
      entityType: "content_item",
      entityId: item.id,
    })),
  });
}

async function move(tx: Tx, item: Item, to: string, actorId: string | null, note?: string | null) {
  assertMove(item.status, to);
  await tx.contentItem.update({ where: { id: item.id }, data: { status: to as never } });
  await recordStatus(tx, {
    agencyId: item.agencyId,
    clientId: item.clientId,
    contentItemId: item.id,
    from: item.status,
    to,
    actorId,
    note,
  });
}

// ---- Review ---------------------------------------------------------------------------------------------------------

export async function submitForReview(
  actor: Actor,
  contentItemId: string,
  input: { note?: string; dueAt?: Date } = {},
) {
  const item = await loadItem(contentItemId);
  const ctx = await requirePermission(actor, item.clientId, "content.create");
  if (!item.currentVersion?.body.trim())
    throw new ConflictError("Write the text before sending it for review");
  assertMove(item.status, "in_review");
  const reviewers = new Set(
    await listUsersWithPermission(item.agencyId, item.clientId, "content.approve"),
  );
  for (const c of await clientUserIds(item.clientId)) reviewers.delete(c);
  return prisma().$transaction(async (tx) => {
    // A new request replaces any open one for older versions.
    await tx.contentApproval.updateMany({
      where: { contentItemId, status: "pending" },
      data: { status: "cancelled" },
    });
    const approval = await tx.contentApproval.create({
      data: {
        agencyId: ctx.agencyId,
        clientId: item.clientId,
        contentItemId,
        contentVersionId: item.currentVersionId!,
        stage: "internal",
        requestedById: actor.userId,
        dueAt: input.dueAt ?? null,
      },
      select: { id: true },
    });
    await tx.approvalEvent.create({
      data: {
        agencyId: ctx.agencyId,
        clientId: item.clientId,
        contentApprovalId: approval.id,
        actorId: actor.userId,
        type: "requested",
        note: input.note?.slice(0, 1000) ?? null,
      },
    });
    await move(tx, item, "in_review", actor.userId, input.note);
    await notify(
      tx,
      item,
      reviewers,
      actor.userId,
      "content.review_requested",
      `Review requested: ${item.title}`,
      input.note,
    );
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: item.clientId,
      action: "content.submitted",
      entityType: "content_item",
      entityId: contentItemId,
      after: { versionNo: item.currentVersion!.versionNo },
    });
    return approval;
  });
}

const decisionSchema = z.object({
  decision: z.enum(["approve", "request_changes", "reject"]),
  note: z.string().trim().max(2000).optional(),
});

/**
 * Decide the pending review of the current version. The stage follows the status: internal review needs
 * content.approve; client approval additionally needs the client role. Nobody approves a version they wrote.
 */
export async function decideReview(
  actor: Actor,
  contentItemId: string,
  raw: z.input<typeof decisionSchema>,
) {
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success)
    throw new ValidationError({ decision: ["Choose approve, request changes or reject"] });
  const { decision, note } = parsed.data;
  if (decision !== "approve" && !note)
    throw new ValidationError({ note: ["Say what needs to change"] });
  const item = await loadItem(contentItemId);
  const ctx = await requirePermission(actor, item.clientId, "content.approve");
  const stage =
    item.status === "in_review" ? "internal" : item.status === "client_approval" ? "client" : null;
  if (!stage) throw new ConflictError("This content is not waiting for a decision");
  const clients = await clientUserIds(item.clientId);
  if (stage === "client" && !clients.has(actor.userId))
    throw new ConflictError("Only the client can give the client approval");
  if (stage === "internal" && clients.has(actor.userId) && !ctx.access.isPlatformAdmin)
    throw new ConflictError("The client approves after the internal review");
  if (item.currentVersion?.createdById === actor.userId)
    throw new ConflictError("You wrote this version, so someone else has to review it");

  return prisma().$transaction(async (tx) => {
    const approval = await tx.contentApproval.findFirst({
      where: { contentItemId, contentVersionId: item.currentVersionId!, stage, status: "pending" },
      select: { id: true },
    });
    if (!approval)
      throw new ConflictError("There is no open review request for the current version");
    const status =
      decision === "approve"
        ? "approved"
        : decision === "reject"
          ? "rejected"
          : "changes_requested";
    await tx.contentApproval.update({
      where: { id: approval.id },
      data: {
        status,
        decidedById: actor.userId,
        decidedAt: new Date(),
        decisionNote: note ?? null,
      },
    });
    await tx.approvalEvent.create({
      data: {
        agencyId: ctx.agencyId,
        clientId: item.clientId,
        contentApprovalId: approval.id,
        actorId: actor.userId,
        type: status,
        note: note ?? null,
      },
    });
    if (note)
      await tx.contentComment.create({
        data: {
          agencyId: ctx.agencyId,
          clientId: item.clientId,
          contentItemId,
          contentVersionId: item.currentVersionId,
          authorId: actor.userId,
          body: note,
          isChangeRequest: decision === "request_changes",
        },
      });

    const author = [item.currentVersion?.createdById, item.createdById, item.assignedToId].filter(
      (x): x is string => !!x,
    );
    if (decision === "approve") {
      if (stage === "internal" && item.requiresClientApproval) {
        await move(tx, item, "client_approval", actor.userId, "Internal review passed");
        await tx.contentApproval
          .create({
            data: {
              agencyId: ctx.agencyId,
              clientId: item.clientId,
              contentItemId,
              contentVersionId: item.currentVersionId!,
              stage: "client",
              requestedById: actor.userId,
            },
          })
          .then(async (a) =>
            tx.approvalEvent.create({
              data: {
                agencyId: ctx.agencyId,
                clientId: item.clientId,
                contentApprovalId: a.id,
                actorId: actor.userId,
                type: "requested",
              },
            }),
          );
        await notify(
          tx,
          item,
          clients,
          actor.userId,
          "content.client_approval_requested",
          `Your approval is needed: ${item.title}`,
        );
        await notify(
          tx,
          item,
          author,
          actor.userId,
          "content.internal_approved",
          `Passed internal review: ${item.title}`,
          "Waiting for the client.",
        );
      } else {
        await move(
          tx,
          item,
          "approved",
          actor.userId,
          stage === "client" ? "Client approved" : "Approved",
        );
        await notify(
          tx,
          item,
          author,
          actor.userId,
          "content.approved",
          `Approved: ${item.title}`,
          "It can now be scheduled.",
        );
      }
    } else {
      await move(
        tx,
        item,
        decision === "reject" ? "rejected" : "changes_requested",
        actor.userId,
        note,
      );
      await notify(
        tx,
        item,
        author,
        actor.userId,
        decision === "reject" ? "content.rejected" : "content.changes_requested",
        `${decision === "reject" ? "Rejected" : "Changes requested"}: ${item.title}`,
        note,
      );
    }
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: item.clientId,
      action: `content.${status}`,
      entityType: "content_item",
      entityId: contentItemId,
      after: { stage, versionNo: item.currentVersion?.versionNo ?? null },
    });
  });
}

/** Reopen rejected / cancelled / changes-requested work as a draft. */
export async function reopenAsDraft(actor: Actor, contentItemId: string) {
  const item = await loadItem(contentItemId);
  const ctx = await requirePermission(actor, item.clientId, "content.create");
  await prisma().$transaction(async (tx) => {
    await move(tx, item, "draft", actor.userId);
    await tx.contentApproval.updateMany({
      where: { contentItemId, status: "pending" },
      data: { status: "cancelled" },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: item.clientId,
      action: "content.reopened",
      entityType: "content_item",
      entityId: contentItemId,
    });
  });
}

/** Idea -> brief -> draft, and cancelling. (Review and publishing moves have their own functions.) */
export async function advanceContent(
  actor: Actor,
  contentItemId: string,
  to: "brief" | "draft" | "cancelled",
  note?: string,
) {
  const item = await loadItem(contentItemId);
  const ctx = await requirePermission(actor, item.clientId, "content.create");
  if (to === "cancelled" && ["scheduled", "publishing"].includes(item.status))
    throw new ConflictError("Unschedule it first");
  await prisma().$transaction(async (tx) => {
    await move(tx, item, to, actor.userId, note);
    if (to === "cancelled")
      await tx.contentApproval.updateMany({
        where: { contentItemId, status: "pending" },
        data: { status: "cancelled" },
      });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: item.clientId,
      action: `content.${to}`,
      entityType: "content_item",
      entityId: contentItemId,
    });
  });
}

export async function setClientApprovalRequired(
  actor: Actor,
  contentItemId: string,
  required: boolean,
) {
  const item = await loadItem(contentItemId);
  const ctx = await requirePermission(actor, item.clientId, "content.create");
  if (!["idea", "brief", "draft", "changes_requested", "rejected"].includes(item.status))
    throw new ConflictError("This can only be changed before the content is sent for review");
  await prisma().$transaction(async (tx) => {
    await tx.contentItem.update({
      where: { id: contentItemId },
      data: { requiresClientApproval: required },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: item.clientId,
      action: "content.client_approval_toggled",
      entityType: "content_item",
      entityId: contentItemId,
      after: { required },
    });
  });
}

export async function addContentComment(actor: Actor, contentItemId: string, body: string) {
  const item = await loadItem(contentItemId);
  const ctx = await requirePermission(actor, item.clientId, "content.view");
  const text = body.trim();
  if (!text) throw new ValidationError({ body: ["Write a comment"] });
  if (text.length > 4000) throw new ValidationError({ body: ["That is too long"] });
  await prisma().$transaction(async (tx) => {
    await tx.contentComment.create({
      data: {
        agencyId: ctx.agencyId,
        clientId: item.clientId,
        contentItemId,
        contentVersionId: item.currentVersionId,
        authorId: actor.userId,
        body: text,
      },
    });
    await notify(
      tx,
      item,
      [item.createdById, item.assignedToId].filter((x): x is string => !!x),
      actor.userId,
      "content.comment",
      `New comment on ${item.title}`,
      text.slice(0, 200),
    );
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: item.clientId,
      action: "content.commented",
      entityType: "content_item",
      entityId: contentItemId,
    });
  });
}

// ---- Media ----------------------------------------------------------------------------------------------------------

export type MediaInput = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  sha256: string;
  width?: number;
  height?: number;
  altText?: string;
};

export async function attachMedia(actor: Actor, contentItemId: string, m: MediaInput) {
  const item = await loadItem(contentItemId);
  const ctx = await requirePermission(actor, item.clientId, "content.create");
  const isImage = IMAGE_TYPES.includes(m.mimeType);
  const isVideo = VIDEO_TYPES.includes(m.mimeType);
  if (!isImage && !isVideo)
    throw new ValidationError({
      file: ["Use a JPEG, PNG, WebP or GIF image, or an MP4 or MOV video"],
    });
  if (m.sizeBytes > (isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES))
    throw new ValidationError({
      file: [
        `That file is too large (limit ${(isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES) / 1024 / 1024} MB)`,
      ],
    });
  if (["scheduled", "publishing", "published"].includes(item.status))
    throw new ConflictError("Unschedule the content before changing its media");
  const count = await prisma().contentAsset.count({
    where: { contentItemId, clientId: item.clientId, deletedAt: null },
  });
  if (count >= 20) throw new ValidationError({ file: ["A post can have up to 20 files"] });
  return prisma().$transaction(async (tx) => {
    const asset = await tx.contentAsset.create({
      data: {
        agencyId: ctx.agencyId,
        clientId: item.clientId,
        contentItemId,
        kind: isImage ? "image" : "video",
        fileName: m.fileName.slice(0, 200),
        mimeType: m.mimeType,
        sizeBytes: BigInt(m.sizeBytes),
        width: m.width ?? null,
        height: m.height ?? null,
        altText: m.altText?.slice(0, 500) ?? null,
        storageKey: m.storageKey,
        sha256: m.sha256,
        createdById: actor.userId,
      },
      select: { id: true },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: item.clientId,
      action: "content.media_attached",
      entityType: "content_item",
      entityId: contentItemId,
      after: { assetId: asset.id },
    });
    return asset;
  });
}

export async function removeMedia(actor: Actor, assetId: string) {
  const asset = await prisma().contentAsset.findUnique({
    where: { id: assetId },
    select: { clientId: true, contentItemId: true, storageKey: true, deletedAt: true },
  });
  if (!asset || asset.deletedAt || !asset.contentItemId) throw new NotFoundError("File not found");
  const item = await loadItem(asset.contentItemId);
  const ctx = await requirePermission(actor, asset.clientId, "content.create");
  if (["scheduled", "publishing", "published"].includes(item.status))
    throw new ConflictError("Unschedule the content before changing its media");
  await prisma().$transaction(async (tx) => {
    await tx.contentAsset.update({ where: { id: assetId }, data: { deletedAt: new Date() } });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: asset.clientId,
      action: "content.media_removed",
      entityType: "content_item",
      entityId: asset.contentItemId!,
      after: { assetId },
    });
  });
  return asset.storageKey;
}

// ---- Publishing: preflight, scheduling, manual fallback --------------------------------------------------------------

/** What a connected provider can do. GoHighLevel's adapter posts text; media needs a person. */
export const PROVIDER_CAPABILITIES: Record<string, { text: boolean; media: boolean }> = {
  gohighlevel: { text: true, media: false },
};

export type Preflight = ValidationResult & {
  mode: "direct" | "manual";
  approvalsOk: boolean;
  directReasons: string[];
  accounts: {
    id: string;
    providerKey: string;
    name: string;
    socialAccounts: { externalId: string; name: string | null; platform: string | null }[];
  }[];
};

async function approvalState(item: Item) {
  const approved = async (stage: "internal" | "client") =>
    !!(await prisma().contentApproval.findFirst({
      where: {
        contentItemId: item.id,
        contentVersionId: item.currentVersionId ?? "none",
        stage,
        status: "approved",
      },
      select: { id: true },
    }));
  const internal = await approved("internal");
  const client = item.requiresClientApproval ? await approved("client") : true;
  return { internal, client, ok: internal && client };
}

/**
 * Steps 1-3 of publishing, without side effects: validate the text and media for the channel, check what the
 * connected accounts can really do, and check the approvals for exactly this version. Reported as lists, so the
 * screen can say everything that is wrong at once.
 */
export async function preflightPublish(actor: Actor, contentItemId: string): Promise<Preflight> {
  const item = await loadItem(contentItemId);
  const ctx = await requirePermission(actor, item.clientId, "content.view");
  const [media, brand, version, approvals, accounts] = await Promise.all([
    ctx.db.contentAsset.findMany({
      where: { contentItemId, deletedAt: null },
      select: { fileName: true, mimeType: true, sizeBytes: true, altText: true },
    }),
    prisma().brandGuideline.findFirst({
      where: { clientId: item.clientId, isActive: true },
      select: { bannedTerms: true },
    }),
    item.currentVersionId
      ? prisma().contentVersion.findUnique({
          where: { id: item.currentVersionId },
          select: { body: true, metadata: true },
        })
      : null,
    approvalState(item),
    ctx.db.integrationAccount.findMany({
      where: { status: "active", integration: { key: { in: Object.keys(PROVIDER_CAPABILITIES) } } },
      select: {
        id: true,
        displayName: true,
        metadata: true,
        integration: { select: { key: true } },
      },
    }),
  ]);
  const socials = accounts.length
    ? await ctx.db.providerSocialAccount.findMany({
        where: { integrationAccountId: { in: accounts.map((a) => a.id) }, isExpired: false },
        select: { integrationAccountId: true, externalId: true, name: true, platform: true },
      })
    : [];
  const channel = item.channel as Channel;
  const hashtags = ((version?.metadata ?? {}) as { hashtags?: string[] }).hashtags ?? [];
  const result = validateContent(channel, {
    body: version?.body ?? "",
    hashtags,
    media: media.map((m) => ({ ...m, sizeBytes: Number(m.sizeBytes) })),
    bannedTerms: brand?.bannedTerms,
  });
  const errors = [...result.errors];
  if (!approvals.internal) errors.push("The current version has not been approved.");
  else if (!approvals.client) errors.push("The client has not approved the current version.");

  const platforms = directPlatformsFor(channel);
  const usable = accounts
    .filter((a) => (a.metadata as { mock?: boolean }).mock !== true)
    .map((a) => ({
      id: a.id,
      providerKey: a.integration.key,
      name: a.displayName ?? a.integration.key,
      socialAccounts: socials
        .filter(
          (s) =>
            s.integrationAccountId === a.id &&
            s.platform &&
            platforms.includes(s.platform.toLowerCase()),
        )
        .map((s) => ({ externalId: s.externalId, name: s.name, platform: s.platform })),
    }))
    .filter((a) => a.socialAccounts.length > 0);
  const directReasons: string[] = [];
  if (platforms.length === 0)
    directReasons.push(
      `${channel === "website" ? "Website" : "Email"} content has no provider that can post it: publish it by hand.`,
    );
  else if (usable.length === 0)
    directReasons.push(
      "No connected account has a matching, active social profile for this channel.",
    );
  if (media.length > 0 && !usable.some((a) => PROVIDER_CAPABILITIES[a.providerKey]?.media))
    directReasons.push(
      "The connected provider can post text only. A post with images or video has to be published by hand.",
    );
  return {
    ...result,
    errors,
    warnings: result.warnings,
    mode: directReasons.length === 0 ? "direct" : "manual",
    approvalsOk: approvals.ok,
    directReasons,
    accounts: directReasons.length === 0 ? usable : [],
  };
}

const scheduleSchema = z.object({
  scheduledLocal: z.string().min(1, "Choose a date and time"),
  /** Direct publishing through a connected account; omit to publish by hand at that time. */
  integrationAccountId: z.uuid().optional(),
  targetAccountIds: z.array(z.string().min(1)).max(20).default([]),
});

/**
 * Schedule an approved item. `scheduledLocal` is wall time in the CLIENT's time zone and is converted once to a UTC
 * instant. Direct mode creates the durable publishing job (one per version and account); manual mode only marks it
 * scheduled so the calendar shows who has to post it.
 */
export async function scheduleContent(
  actor: Actor,
  contentItemId: string,
  raw: z.input<typeof scheduleSchema>,
  now = new Date(),
) {
  const parsed = scheduleSchema.safeParse(raw);
  if (!parsed.success)
    throw new ValidationError(
      Object.fromEntries(parsed.error.issues.map((i) => [i.path.join(".") || "form", [i.message]])),
    );
  const item = await loadItem(contentItemId);
  const ctx = await requirePermission(actor, item.clientId, "content.publish");
  if (!["approved", "failed"].includes(item.status))
    throw new ConflictError("Only approved content can be scheduled");
  const tz = (
    await prisma().client.findUniqueOrThrow({
      where: { id: item.clientId },
      select: { timezone: true },
    })
  ).timezone;
  const when = parseSchedule(parsed.data.scheduledLocal, tz)!;
  if (when.getTime() < now.getTime() + 60_000)
    throw new ValidationError({ scheduledLocal: ["Choose a time in the future"] });

  const pre = await preflightPublish(actor, contentItemId);
  if (pre.errors.length > 0) throw new ValidationError({ form: pre.errors });
  const direct = !!parsed.data.integrationAccountId;
  if (direct) {
    if (pre.mode !== "direct")
      throw new ValidationError({ integrationAccountId: pre.directReasons });
    const account = pre.accounts.find((a) => a.id === parsed.data.integrationAccountId);
    if (!account)
      throw new ValidationError({
        integrationAccountId: ["Choose an account that can post to this channel"],
      });
    const allowed = new Set(account.socialAccounts.map((s) => s.externalId));
    if (
      parsed.data.targetAccountIds.length === 0 ||
      parsed.data.targetAccountIds.some((t) => !allowed.has(t))
    )
      throw new ValidationError({ targetAccountIds: ["Choose profiles that match this channel"] });
  }
  await prisma().contentItem.update({
    where: { id: contentItemId },
    data: { scheduledFor: when, scheduledTimezone: tz },
  });
  if (direct) {
    const job = await requestPublish(actor, {
      integrationAccountId: parsed.data.integrationAccountId!,
      contentItemId,
      targetAccountIds: parsed.data.targetAccountIds,
      scheduledFor: when,
    });
    return { mode: "direct" as const, jobId: job.id, scheduledFor: when };
  }
  await prisma().$transaction(async (tx) => {
    await move(tx, item, "scheduled", actor.userId, "Scheduled for manual publishing");
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: item.clientId,
      action: "content.scheduled_manual",
      entityType: "content_item",
      entityId: contentItemId,
      after: { scheduledFor: when.toISOString(), timezone: tz },
    });
  });
  return { mode: "manual" as const, jobId: null, scheduledFor: when };
}

export async function unscheduleContent(actor: Actor, contentItemId: string) {
  const item = await loadItem(contentItemId);
  const ctx = await requirePermission(actor, item.clientId, "content.publish");
  if (item.status !== "scheduled")
    throw new ConflictError("Only scheduled content can be unscheduled");
  const job = await prisma().publishingJob.findFirst({
    where: { contentItemId, clientId: item.clientId, status: { in: ["queued", "scheduled"] } },
    select: { id: true },
  });
  if (job) return cancelPublish(actor, job.id);
  const active = await prisma().publishingJob.findFirst({
    where: {
      contentItemId,
      clientId: item.clientId,
      status: { in: ["publishing", "needs_review"] },
    },
    select: { id: true },
  });
  if (active) throw new ConflictError("Publishing has already started");
  await prisma().$transaction(async (tx) => {
    await move(tx, item, "approved", actor.userId, "Unscheduled");
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: item.clientId,
      action: "content.unscheduled",
      entityType: "content_item",
      entityId: contentItemId,
    });
  });
}

/** The fallback when direct publishing is not possible: a person posted it; record where and when. Needs the same approvals. */
export async function markPublishedManually(
  actor: Actor,
  contentItemId: string,
  input: { publishedUrl?: string; publishedAt?: Date; note?: string } = {},
  now = new Date(),
) {
  const item = await loadItem(contentItemId);
  const ctx = await requirePermission(actor, item.clientId, "content.publish");
  if (!["approved", "scheduled", "failed"].includes(item.status))
    throw new ConflictError("Only approved or scheduled content can be marked as published");
  if (!(await approvalState(item)).ok)
    throw new ConflictError("The current version is not fully approved");
  const active = await prisma().publishingJob.findFirst({
    where: {
      contentItemId,
      clientId: item.clientId,
      status: { in: ["queued", "scheduled", "publishing", "needs_review", "succeeded"] },
    },
    select: { id: true, status: true },
  });
  if (active)
    throw new ConflictError(
      "A direct publishing job exists for this content. Cancel it or resolve it first so the post is not duplicated",
    );
  if (input.publishedUrl && !z.url().safeParse(input.publishedUrl).success)
    throw new ValidationError({ publishedUrl: ["Enter the full link, starting with https://"] });
  const at = input.publishedAt ?? now;
  try {
    await prisma().$transaction(async (tx) => {
      await tx.manualPublication.create({
        data: {
          agencyId: ctx.agencyId,
          clientId: item.clientId,
          contentItemId,
          contentVersionId: item.currentVersionId!,
          publishedUrl: input.publishedUrl ?? null,
          publishedAt: at,
          note: input.note?.slice(0, 1000) ?? null,
          markedById: actor.userId,
        },
      });
      await tx.contentItem.update({
        where: { id: contentItemId },
        data: { status: "published", publishedAt: at },
      });
      await recordStatus(tx, {
        agencyId: ctx.agencyId,
        clientId: item.clientId,
        contentItemId,
        from: item.status,
        to: "published",
        actorId: actor.userId,
        note: "Published by hand",
      });
      await notify(
        tx,
        item,
        [item.createdById, item.assignedToId].filter((x): x is string => !!x),
        actor.userId,
        "publishing.succeeded",
        `Published: ${item.title}`,
      );
      await recordAudit(tx, {
        actorUserId: actor.userId,
        agencyId: ctx.agencyId,
        clientId: item.clientId,
        action: "content.published_manually",
        entityType: "content_item",
        entityId: contentItemId,
        after: { url: input.publishedUrl ?? null },
      });
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002")
      throw new ConflictError("This version was already marked as published");
    throw error;
  }
}

// ---- Reading --------------------------------------------------------------------------------------------------------

export async function getContentDetail(actor: Actor, contentItemId: string) {
  const found = await prisma().contentItem.findUnique({
    where: { id: contentItemId },
    select: { clientId: true },
  });
  if (!found) throw new NotFoundError("Content not found");
  const ctx = await requirePermission(actor, found.clientId, "content.view");
  const db = ctx.db;
  const [
    item,
    versions,
    comments,
    events,
    approvals,
    assets,
    jobs,
    manual,
    canCreate,
    canApprove,
    canPublish,
    clients,
    client,
  ] = await Promise.all([
    db.contentItem.findFirstOrThrow({
      where: { id: contentItemId },
      include: {
        project: { select: { name: true } },
        createdBy: { select: { name: true } },
        currentVersion: true,
      },
    }),
    db.contentVersion.findMany({
      where: { contentItemId },
      orderBy: { versionNo: "desc" },
      select: {
        id: true,
        versionNo: true,
        title: true,
        authorKind: true,
        changeNote: true,
        createdAt: true,
        aiJobId: true,
        createdBy: { select: { name: true } },
      },
    }),
    db.contentComment.findMany({
      where: { contentItemId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        body: true,
        isChangeRequest: true,
        createdAt: true,
        contentVersionId: true,
        author: { select: { name: true } },
      },
    }),
    db.contentStatusEvent.findMany({
      where: { contentItemId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        note: true,
        createdAt: true,
        actor: { select: { name: true } },
      },
    }),
    db.contentApproval.findMany({
      where: { contentItemId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        stage: true,
        status: true,
        decisionNote: true,
        decidedAt: true,
        createdAt: true,
        contentVersion: { select: { versionNo: true } },
        decidedBy: { select: { name: true } },
      },
    }),
    db.contentAsset.findMany({
      where: { contentItemId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        kind: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        altText: true,
        createdAt: true,
      },
    }),
    db.publishingJob.findMany({
      where: { contentItemId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        attempts: true,
        lastError: true,
        scheduledFor: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true,
        contentVersion: { select: { versionNo: true } },
        integrationAccount: { select: { displayName: true } },
        publishedPost: { select: { externalPostId: true, permalink: true, publishedAt: true } },
      },
    }),
    db.manualPublication.findMany({
      where: { contentItemId },
      orderBy: { publishedAt: "desc" },
      select: {
        id: true,
        publishedUrl: true,
        publishedAt: true,
        note: true,
        markedBy: { select: { name: true } },
      },
    }),
    requirePermission(actor, found.clientId, "content.create")
      .then(() => true)
      .catch(() => false),
    requirePermission(actor, found.clientId, "content.approve")
      .then(() => true)
      .catch(() => false),
    requirePermission(actor, found.clientId, "content.publish")
      .then(() => true)
      .catch(() => false),
    clientUserIds(found.clientId),
    prisma().client.findUniqueOrThrow({
      where: { id: found.clientId },
      select: { name: true, timezone: true },
    }),
  ]);
  const isClientUser = clients.has(actor.userId);
  const stageStatus = item.status;
  return {
    item,
    versions,
    comments,
    events,
    approvals,
    assets,
    jobs,
    manual,
    client,
    can: {
      edit: canCreate && (EDIT_OK as readonly string[]).includes(item.status),
      submit: canCreate && ["draft", "changes_requested"].includes(item.status),
      decide:
        canApprove &&
        ((stageStatus === "in_review" && !isClientUser) ||
          (stageStatus === "client_approval" && isClientUser)) &&
        item.currentVersion?.createdById !== actor.userId,
      publish: canPublish,
      advance: canCreate,
    },
  };
}
const EDIT_OK = [
  "idea",
  "brief",
  "draft",
  "changes_requested",
  "rejected",
  "in_review",
  "client_approval",
  "approved",
] as const;

// ---- Calendar -------------------------------------------------------------------------------------------------------

export type CalendarItem = {
  id: string;
  title: string;
  channel: string;
  status: string;
  clientId: string;
  clientName: string;
  timezone: string;
  scheduledFor: Date;
  localDay: string;
  localTime: string;
  manual: boolean;
  requiresClientApproval: boolean;
};

/**
 * Items scheduled between two calendar days (YYYY-MM-DD, inclusive), each placed on the day it falls on in ITS
 * CLIENT's time zone, plus the work that has no date yet. The range is widened in the query and then cut by local
 * day, so a post at 23:30 in Vancouver lands on the right day whatever zone the viewer is in.
 */
export async function getContentCalendar(
  actor: Actor,
  f: { clientId?: string; from: string; to: string },
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.from) || !/^\d{4}-\d{2}-\d{2}$/.test(f.to))
    throw new ValidationError({ from: ["Invalid date"] });
  const map = await getAccessMap(actor);
  const allowed = clientIdsWith(map, "content.view");
  const ids = f.clientId ? allowed.filter((c) => c === f.clientId) : allowed;
  if (ids.length === 0)
    return {
      items: [] as CalendarItem[],
      unscheduled: [] as {
        id: string;
        title: string;
        channel: string;
        status: string;
        clientName: string;
      }[],
    };
  const db = forClients(ids);
  const widen = 18 * 3_600_000;
  const start = new Date(Date.parse(`${f.from}T00:00:00Z`) - widen);
  const end = new Date(Date.parse(`${f.to}T23:59:59Z`) + widen);
  const [rows, loose] = await Promise.all([
    db.contentItem.findMany({
      where: {
        archivedAt: null,
        status: { notIn: ["cancelled", "archived"] },
        scheduledFor: { gte: start, lte: end },
      },
      orderBy: { scheduledFor: "asc" },
      take: 1000,
      select: {
        id: true,
        title: true,
        channel: true,
        status: true,
        clientId: true,
        scheduledFor: true,
        requiresClientApproval: true,
        client: { select: { name: true, timezone: true } },
        publishingJobs: { where: { status: { not: "cancelled" } }, select: { id: true }, take: 1 },
      },
    }),
    db.contentItem.findMany({
      where: {
        archivedAt: null,
        scheduledFor: null,
        status: {
          in: [
            "idea",
            "brief",
            "draft",
            "in_review",
            "client_approval",
            "changes_requested",
            "approved",
          ],
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        title: true,
        channel: true,
        status: true,
        client: { select: { name: true } },
      },
    }),
  ]);
  const items = rows
    .map((r) => {
      const day = zonedDay(r.scheduledFor!, r.client.timezone);
      const local = r.scheduledFor!.toLocaleTimeString("en-GB", {
        timeZone: r.client.timezone,
        hour: "2-digit",
        minute: "2-digit",
      });
      return {
        id: r.id,
        title: r.title,
        channel: r.channel,
        status: r.status,
        clientId: r.clientId,
        clientName: r.client.name,
        timezone: r.client.timezone,
        scheduledFor: r.scheduledFor!,
        localDay: day,
        localTime: local,
        manual: r.publishingJobs.length === 0,
        requiresClientApproval: r.requiresClientApproval,
      };
    })
    .filter((i) => i.localDay >= f.from && i.localDay <= f.to);
  return {
    items,
    unscheduled: loose.map((l) => ({
      id: l.id,
      title: l.title,
      channel: l.channel,
      status: l.status,
      clientName: l.client.name,
    })),
  };
}

export async function listContentForCalendar(actor: Actor) {
  const map = await getAccessMap(actor);
  return { canCreate: clientIdsWith(map, "content.create").length > 0 };
}

void CHANNELS;
void CHANNEL_RULES;
