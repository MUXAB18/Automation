import { z } from "zod";
import { forClients, requirePermission, type Actor } from "../access";
import { recordAudit } from "../audit";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import type { Prisma } from "../generated/client";
import { CHANNELS } from "../ai/templates";
import { LocalTimeError, zonedLocalToUtc } from "../time-zone";
import { getUnscopedPrisma } from "../unsafe";
import type { AiOutput } from "../ai/templates";

/**
 * Content items and their versions. A version is immutable: every edit, every AI draft and every restore adds the
 * next version number, so the history is complete. AI-authored versions are always drafts: they only reach
 * `scheduled` or `published` through the review and approval workflow (content-workflow.ts).
 */

const prisma = () => getUnscopedPrisma();
type Tx = Prisma.TransactionClient;

export const EDITABLE_STATUSES = [
  "idea",
  "brief",
  "draft",
  "changes_requested",
  "rejected",
  "in_review",
  "client_approval",
  "approved",
] as const;

export const versionMetaSchema = z.object({
  hashtags: z
    .array(
      z
        .string()
        .trim()
        .regex(/^#[\p{L}\p{N}_]{2,60}$/u, "Hashtags look like #example"),
    )
    .max(30)
    .default([]),
  seoTitle: z.string().trim().max(120).optional(),
  metaDescription: z.string().trim().max(320).optional(),
});
export type VersionMeta = z.output<typeof versionMetaSchema>;

const issues = (error: z.ZodError) =>
  Object.fromEntries(error.issues.map((i) => [i.path.join(".") || "form", [i.message]]));

const createSchema = z.object({
  projectId: z.uuid().nullish(),
  calendarId: z.uuid().nullish(),
  title: z.string().trim().min(2, "Give it a title").max(200),
  type: z
    .enum(["social_post", "blog_post", "page_update", "email", "other"])
    .default("social_post"),
  channel: z.enum(CHANNELS),
  status: z.enum(["idea", "brief", "draft"]).default("draft"),
  brief: z.string().trim().max(10_000).optional(),
  body: z.string().trim().max(100_000).optional(),
  meta: versionMetaSchema.optional(),
  requiresClientApproval: z.coerce.boolean().default(false),
  /** Wall time in the client's time zone: "2026-11-02T09:30". */
  scheduledLocal: z.string().optional(),
});

/** Parse a wall-clock schedule in the client's zone. Empty = no schedule. */
export function parseSchedule(local: string | null | undefined, timeZone: string): Date | null {
  if (!local) return null;
  try {
    return zonedLocalToUtc(local, timeZone);
  } catch (e) {
    if (e instanceof LocalTimeError) throw new ValidationError({ scheduledLocal: [e.message] });
    throw e;
  }
}

export async function recordStatus(
  tx: Tx,
  a: {
    agencyId: string;
    clientId: string;
    contentItemId: string;
    from: string | null;
    to: string;
    actorId: string | null;
    note?: string | null;
  },
) {
  await tx.contentStatusEvent.create({
    data: {
      agencyId: a.agencyId,
      clientId: a.clientId,
      contentItemId: a.contentItemId,
      fromStatus: a.from as never,
      toStatus: a.to as never,
      actorId: a.actorId,
      note: a.note ?? null,
    },
  });
}

async function nextVersion(tx: Tx, contentItemId: string) {
  const last = await tx.contentVersion.aggregate({
    where: { contentItemId },
    _max: { versionNo: true },
  });
  return (last._max.versionNo ?? 0) + 1;
}

export async function createContentItem(
  actor: Actor,
  clientId: string,
  raw: z.input<typeof createSchema>,
) {
  const ctx = await requirePermission(actor, clientId, "content.create");
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(issues(parsed.error));
  const v = parsed.data;
  const client = await prisma().client.findUniqueOrThrow({
    where: { id: clientId },
    select: { timezone: true },
  });
  if (
    v.projectId &&
    !(await prisma().project.findFirst({
      where: { id: v.projectId, clientId, archivedAt: null },
      select: { id: true },
    }))
  )
    throw new ValidationError({ projectId: ["Choose one of this client's projects"] });
  const scheduledFor = parseSchedule(v.scheduledLocal, client.timezone);
  return prisma().$transaction(async (tx) => {
    const item = await tx.contentItem.create({
      data: {
        agencyId: ctx.agencyId,
        clientId,
        projectId: v.projectId ?? null,
        calendarId: v.calendarId ?? null,
        title: v.title,
        type: v.type,
        channel: v.channel,
        status: v.status,
        brief: v.brief ?? null,
        requiresClientApproval: v.requiresClientApproval,
        scheduledFor,
        scheduledTimezone: scheduledFor ? client.timezone : null,
        createdById: actor.userId,
      },
      select: { id: true },
    });
    if (v.body) {
      const version = await tx.contentVersion.create({
        data: {
          agencyId: ctx.agencyId,
          clientId,
          contentItemId: item.id,
          versionNo: 1,
          title: v.title,
          body: v.body,
          metadata: (v.meta ?? { hashtags: [] }) as Prisma.InputJsonObject,
          createdById: actor.userId,
          authorKind: "human",
          changeNote: "First draft",
        },
      });
      await tx.contentItem.update({
        where: { id: item.id },
        data: { currentVersionId: version.id },
      });
    }
    await recordStatus(tx, {
      agencyId: ctx.agencyId,
      clientId,
      contentItemId: item.id,
      from: null,
      to: v.status,
      actorId: actor.userId,
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId,
      action: "content.created",
      entityType: "content_item",
      entityId: item.id,
      after: { channel: v.channel, status: v.status },
    });
    return item;
  });
}

/**
 * Add the next version. Editing something that was in review or approved invalidates that decision (approvals are
 * tied to one version), so the item goes back to draft and any open approval is cancelled. Something already
 * scheduled for publishing must be unscheduled first, so an approved text can never change under a publishing job.
 */
export async function saveContentVersion(
  actor: Actor,
  contentItemId: string,
  raw: {
    title?: string;
    body: string;
    meta?: unknown;
    changeNote?: string;
    expectedVersionNo?: number;
  },
  opts: { authorKind?: "human" | "ai"; aiJobId?: string } = {},
) {
  const found = await prisma().contentItem.findUnique({
    where: { id: contentItemId },
    select: { clientId: true },
  });
  if (!found) throw new NotFoundError("Content not found");
  const ctx = await requirePermission(actor, found.clientId, "content.create");
  const body = (raw.body ?? "").trim();
  if (!body) throw new ValidationError({ body: ["Write some text first"] });
  if (body.length > 100_000) throw new ValidationError({ body: ["That is too long"] });
  const meta = versionMetaSchema.safeParse(raw.meta ?? {});
  if (!meta.success) throw new ValidationError(issues(meta.error));

  return prisma().$transaction(async (tx) => {
    const item = await tx.contentItem.findFirstOrThrow({
      where: { id: contentItemId, clientId: found.clientId, archivedAt: null },
      select: { id: true, status: true, currentVersion: { select: { versionNo: true } } },
    });
    if (!(EDITABLE_STATUSES as readonly string[]).includes(item.status))
      throw new ConflictError("This content is scheduled or published. Cancel it first to edit.");
    if (
      raw.expectedVersionNo !== undefined &&
      raw.expectedVersionNo !== (item.currentVersion?.versionNo ?? 0)
    )
      throw new ConflictError(
        "Someone saved a newer version while you were editing. Reload to see it.",
      );
    const versionNo = await nextVersion(tx, contentItemId);
    const version = await tx.contentVersion.create({
      data: {
        agencyId: ctx.agencyId,
        clientId: found.clientId,
        contentItemId,
        versionNo,
        title: raw.title?.trim() || null,
        body,
        metadata: meta.data as Prisma.InputJsonObject,
        authorKind: opts.authorKind ?? "human",
        createdById: actor.userId,
        aiJobId: opts.aiJobId ?? null,
        changeNote: raw.changeNote?.trim().slice(0, 300) || null,
      },
      select: { id: true, versionNo: true },
    });
    let status = item.status as string;
    if (
      [
        "in_review",
        "client_approval",
        "approved",
        "rejected",
        "changes_requested",
        "idea",
        "brief",
      ].includes(status)
    ) {
      // A new text needs a new review.
      await tx.contentApproval.updateMany({
        where: { contentItemId, status: "pending" },
        data: { status: "cancelled" },
      });
      status = "draft";
    }
    await tx.contentItem.update({
      where: { id: contentItemId },
      data: { currentVersionId: version.id, status: status as never },
    });
    if (status !== item.status)
      await recordStatus(tx, {
        agencyId: ctx.agencyId,
        clientId: found.clientId,
        contentItemId,
        from: item.status,
        to: status,
        actorId: actor.userId,
        note: "New version saved",
      });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: found.clientId,
      action: "content.version_saved",
      entityType: "content_item",
      entityId: contentItemId,
      after: { versionNo, authorKind: opts.authorKind ?? "human" },
    });
    return version;
  });
}

export async function restoreContentVersion(
  actor: Actor,
  contentItemId: string,
  versionNo: number,
) {
  const found = await prisma().contentItem.findUnique({
    where: { id: contentItemId },
    select: { clientId: true },
  });
  if (!found) throw new NotFoundError("Content not found");
  await requirePermission(actor, found.clientId, "content.create");
  const old = await prisma().contentVersion.findFirst({
    where: { contentItemId, clientId: found.clientId, versionNo },
  });
  if (!old) throw new NotFoundError("Version not found");
  return saveContentVersion(actor, contentItemId, {
    title: old.title ?? undefined,
    body: old.body,
    meta: old.metadata,
    changeNote: `Restored version ${versionNo}`,
  });
}

export async function listContentVersions(actor: Actor, contentItemId: string) {
  const found = await prisma().contentItem.findUnique({
    where: { id: contentItemId },
    select: { clientId: true },
  });
  if (!found) throw new NotFoundError("Content not found");
  const ctx = await requirePermission(actor, found.clientId, "content.view");
  return ctx.db.contentVersion.findMany({
    where: { contentItemId },
    orderBy: { versionNo: "desc" },
    select: {
      id: true,
      versionNo: true,
      title: true,
      body: true,
      metadata: true,
      authorKind: true,
      changeNote: true,
      createdAt: true,
      aiJobId: true,
      createdBy: { select: { name: true } },
    },
  });
}

// ---- AI output -> draft ---------------------------------------------------------------------------------------------

/**
 * Turn a finished generation into a DRAFT (new item, or a new version of an existing one). The version is marked
 * as AI-authored and linked to its job. Nothing is approved or scheduled by this; review does that.
 */
export async function saveAiOutputAsDraft(
  actor: Actor,
  jobId: string,
  opts: { contentItemId?: string; captionIndex?: number; title?: string; channel?: string } = {},
) {
  const job = await prisma().aiJob.findUnique({ where: { id: jobId } });
  if (!job) throw new NotFoundError("Generation not found");
  const ctx = await requirePermission(actor, job.clientId, "content.create");
  await requirePermission(actor, job.clientId, "ai.use");
  if (job.status !== "succeeded" || !job.output)
    throw new ConflictError("This generation has no result yet");
  const result = (job.output as { result: Record<string, unknown> }).result;
  const task = job.task;
  const targetId = opts.contentItemId ?? job.contentItemId ?? undefined;
  const input = job.input as Record<string, unknown>;

  let title: string | undefined;
  let body: string | undefined;
  let meta: VersionMeta = { hashtags: [] };
  let asBrief: string | undefined;
  if (task === "blog_draft") {
    const r = result as AiOutput<"blog_draft">;
    title = r.title;
    body = r.body;
    meta = { hashtags: [], metaDescription: r.metaDescription };
  } else if (task === "social_captions") {
    const r = result as AiOutput<"social_captions">;
    const c = r.captions[opts.captionIndex ?? 0];
    if (!c) throw new ValidationError({ captionIndex: ["Choose one of the captions"] });
    body = c.text;
    meta = { hashtags: c.hashtags };
  } else if (task === "repurpose") {
    const r = result as AiOutput<"repurpose">;
    title = r.title;
    body = r.body;
    meta = { hashtags: r.hashtags };
  } else if (task === "content_brief") {
    const r = result as AiOutput<"content_brief">;
    asBrief = [
      `# ${r.title}`,
      `Search intent: ${r.searchIntent}`,
      "",
      ...r.outline.flatMap((o) => [`## ${o.heading}`, ...o.points.map((p) => `- ${p}`)]),
      "",
      "Key points:",
      ...r.keyPoints.map((k) => `- ${k}`),
      "",
      "Check before using:",
      ...r.claimsToVerify.map((c) => `- ${c}`),
    ].join("\n");
    title = r.title;
  } else {
    throw new ValidationError({
      task: ["This kind of result is for reading. Copy what you need from it"],
    });
  }

  const channel = (opts.channel ??
    (input.channel as string | undefined) ??
    (input.targetChannel as string | undefined) ??
    "website") as (typeof CHANNELS)[number];
  if (!(CHANNELS as readonly string[]).includes(channel))
    throw new ValidationError({ channel: ["Choose a channel"] });
  const type = task === "blog_draft" ? "blog_post" : "social_post";

  if (asBrief !== undefined) {
    return prisma().$transaction(async (tx) => {
      if (targetId) {
        const item = await tx.contentItem.findFirst({
          where: { id: targetId, clientId: job.clientId },
          select: { id: true, status: true },
        });
        if (!item) throw new NotFoundError("Content not found");
        await tx.contentItem.update({ where: { id: item.id }, data: { brief: asBrief } });
        await recordAudit(tx, {
          actorUserId: actor.userId,
          agencyId: ctx.agencyId,
          clientId: job.clientId,
          action: "content.brief_saved_from_ai",
          entityType: "content_item",
          entityId: item.id,
          after: { aiJobId: jobId },
        });
        return { contentItemId: item.id, versionNo: null as number | null };
      }
      const item = await tx.contentItem.create({
        data: {
          agencyId: ctx.agencyId,
          clientId: job.clientId,
          projectId: job.projectId,
          title: (opts.title ?? title ?? "Content brief").slice(0, 200),
          type: "blog_post",
          channel,
          status: "brief",
          brief: asBrief,
          createdById: actor.userId,
        },
        select: { id: true },
      });
      await recordStatus(tx, {
        agencyId: ctx.agencyId,
        clientId: job.clientId,
        contentItemId: item.id,
        from: null,
        to: "brief",
        actorId: actor.userId,
        note: "From an AI brief",
      });
      await recordAudit(tx, {
        actorUserId: actor.userId,
        agencyId: ctx.agencyId,
        clientId: job.clientId,
        action: "content.created",
        entityType: "content_item",
        entityId: item.id,
        after: { aiJobId: jobId },
      });
      return { contentItemId: item.id, versionNo: null as number | null };
    });
  }

  let itemId = targetId;
  if (!itemId) {
    const created = await prisma().$transaction(async (tx) => {
      const item = await tx.contentItem.create({
        data: {
          agencyId: ctx.agencyId,
          clientId: job.clientId,
          projectId: job.projectId,
          title: (opts.title ?? title ?? String(input.topic ?? "AI draft")).slice(0, 200),
          type,
          channel,
          status: "draft",
          createdById: actor.userId,
        },
        select: { id: true },
      });
      await recordStatus(tx, {
        agencyId: ctx.agencyId,
        clientId: job.clientId,
        contentItemId: item.id,
        from: null,
        to: "draft",
        actorId: actor.userId,
        note: "Created from an AI draft",
      });
      return item;
    });
    itemId = created.id;
  }
  const version = await saveContentVersion(
    actor,
    itemId,
    { title, body: body!, meta, changeNote: `AI draft (${task}). Review before use.` },
    { authorKind: "ai", aiJobId: jobId },
  );
  return { contentItemId: itemId, versionNo: version.versionNo };
}

/** Re-exported for the pages: who can see content of these clients. */
export const contentDb = (clientIds: string[]) => forClients(clientIds);

/** Content of one client, for pickers (e.g. "repurpose this"). */
export async function listContentOptions(actor: Actor, clientId: string) {
  const ctx = await requirePermission(actor, clientId, "content.view");
  return ctx.db.contentItem.findMany({
    where: { archivedAt: null, currentVersionId: { not: null } },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: { id: true, title: true, channel: true },
  });
}
