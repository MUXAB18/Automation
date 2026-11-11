import { z } from "zod";
import { requirePermission, type Actor } from "../access";
import { recordAudit } from "../audit";
import { NotFoundError } from "../errors";
import type { Prisma } from "../generated/client";
import { getUnscopedPrisma } from "../unsafe";

/**
 * Persist records a provider adapter normalised. Every row is keyed by (integration account, provider
 * id), so syncing the same record again updates it and never duplicates it. Rows can only land in the
 * client and agency of the account they came from (composite foreign keys).
 */

type Tx = Prisma.TransactionClient;
const prismaClient = () => getUnscopedPrisma();

export type ProviderRecord = {
  resource: string;
  externalId: string;
  data: Record<string, unknown>;
};

export type PersistTarget = {
  agencyId: string;
  clientId: string;
  accountId: string;
  syncRunId: string;
};

const date = z.preprocess(
  (v) => (typeof v === "string" && v ? new Date(v) : null),
  z.date().nullable(),
);
const str = z
  .string()
  .nullish()
  .transform((v) => v ?? null);
const strLong = (max: number) =>
  z
    .string()
    .nullish()
    .transform((v) => (v ? v.slice(0, max) : null));

const contact = z.object({
  name: str,
  firstName: str,
  lastName: str,
  email: str,
  phone: str,
  source: str,
  tags: z.array(z.string()).default([]),
  externalCreatedAt: date,
  externalUpdatedAt: date,
});
const opportunity = z.object({
  name: str,
  status: str,
  monetaryValue: z
    .number()
    .nullish()
    .transform((v) => v ?? null),
  pipelineExternalId: str,
  stageExternalId: str,
  contactExternalId: str,
  assignedToExternalId: str,
  externalCreatedAt: date,
  externalUpdatedAt: date,
});
const pipeline = z.object({
  name: z
    .string()
    .nullish()
    .transform((v) => v ?? "Untitled pipeline"),
  stages: z
    .array(z.object({ id: z.string(), name: str, position: z.number().nullish() }))
    .default([]),
});
const conversation = z.object({
  contactExternalId: str,
  type: str,
  lastMessageType: str,
  lastMessageAt: date,
  unreadCount: z.number().int().nonnegative().default(0),
});
const automation = z.object({
  kind: z.enum(["campaign", "workflow"]),
  name: str,
  status: str,
  version: z
    .number()
    .int()
    .nullish()
    .transform((v) => v ?? null),
  externalCreatedAt: date,
  externalUpdatedAt: date,
});
const socialAccount = z.object({
  profileExternalId: str,
  platform: str,
  name: str,
  type: str,
  isExpired: z.boolean().default(false),
});
const socialPost = z.object({
  platform: str,
  summary: strLong(5000),
  status: str,
  type: str,
  accountExternalIds: z.array(z.string()).default([]),
  platformPostId: str,
  scheduledFor: date,
  publishedAt: date,
  providerError: strLong(500),
  externalCreatedAt: date,
  externalUpdatedAt: date,
});
const socialStat = z.object({
  windowDays: z.number().int().positive().default(7),
  posts: z.number().int().nonnegative().default(0),
  likes: z.number().int().nonnegative().default(0),
  comments: z.number().int().nonnegative().default(0),
  followers: z.number().int().nonnegative().default(0),
  impressions: z.number().nonnegative().default(0),
});

/** Which synced resources this module can store. */
export const PROVIDER_RESOURCES = [
  "pipelines",
  "contacts",
  "opportunities",
  "conversations",
  "campaigns",
  "workflows",
  "social_accounts",
  "social_posts",
  "social_statistics",
] as const;

async function writeBatch(
  tx: Tx,
  t: PersistTarget,
  resource: string,
  records: ProviderRecord[],
): Promise<number> {
  const base = { agencyId: t.agencyId, clientId: t.clientId, integrationAccountId: t.accountId };
  const key = (externalId: string) => ({
    integrationAccountId_externalId: { integrationAccountId: t.accountId, externalId },
  });
  let written = 0;
  for (const r of records) {
    const w = { ...base, externalId: r.externalId };
    switch (resource) {
      case "contacts": {
        const d = contact.parse(r.data);
        await tx.crmContact.upsert({
          where: key(r.externalId),
          create: { ...w, ...d },
          update: { ...d, syncedAt: new Date() },
        });
        break;
      }
      case "opportunities": {
        const d = opportunity.parse(r.data);
        await tx.crmOpportunity.upsert({
          where: key(r.externalId),
          create: { ...w, ...d },
          update: { ...d, syncedAt: new Date() },
        });
        break;
      }
      case "pipelines": {
        const d = pipeline.parse(r.data);
        await tx.crmPipeline.upsert({
          where: key(r.externalId),
          create: { ...w, ...d },
          update: { ...d, syncedAt: new Date() },
        });
        break;
      }
      case "conversations": {
        const d = conversation.parse(r.data);
        await tx.crmConversation.upsert({
          where: key(r.externalId),
          create: { ...w, ...d },
          update: { ...d, syncedAt: new Date() },
        });
        break;
      }
      case "campaigns":
      case "workflows": {
        const d = automation.parse(r.data);
        await tx.crmAutomation.upsert({
          where: {
            integrationAccountId_kind_externalId: {
              integrationAccountId: t.accountId,
              kind: d.kind,
              externalId: r.externalId,
            },
          },
          create: { ...w, ...d },
          update: { ...d, syncedAt: new Date() },
        });
        break;
      }
      case "social_accounts": {
        const d = socialAccount.parse(r.data);
        await tx.providerSocialAccount.upsert({
          where: key(r.externalId),
          create: { ...w, ...d },
          update: { ...d, syncedAt: new Date() },
        });
        break;
      }
      case "social_posts": {
        const d = socialPost.parse(r.data);
        await tx.providerSocialPost.upsert({
          where: key(r.externalId),
          create: { ...w, ...d },
          update: { ...d, syncedAt: new Date() },
        });
        break;
      }
      case "social_statistics": {
        const d = socialStat.parse(r.data);
        // Append-only reading, one per sync run: a re-delivered batch inside the same run is ignored.
        const exists = await tx.providerSocialStat.findUnique({
          where: { syncRunId: t.syncRunId },
          select: { id: true },
        });
        if (exists) continue;
        await tx.providerSocialStat.create({
          data: {
            ...base,
            syncRunId: t.syncRunId,
            ...d,
            impressions: BigInt(Math.round(d.impressions)),
          },
        });
        break;
      }
      default:
        throw new Error(`No storage for resource ${resource}`);
    }
    written++;
  }
  return written;
}

/** Store one page of normalised records. Returns how many were written. Worker (system) use. */
export async function persistProviderRecords(
  target: PersistTarget,
  resource: string,
  records: ProviderRecord[],
): Promise<number> {
  if (records.length === 0) return 0;
  return prismaClient().$transaction(async (tx) => {
    const written = await writeBatch(tx, target, resource, records);
    await recordAudit(tx, {
      actorUserId: null,
      agencyId: target.agencyId,
      clientId: target.clientId,
      action: "integration.records_synced",
      entityType: "sync_run",
      entityId: target.syncRunId,
      after: { resource, written },
    });
    return written;
  });
}

// ---- Read model ---------------------------------------------------------------------------------

/** Counts and the social destinations for one account's detail page. No contact details leave here. */
export async function getProviderDataSummary(actor: Actor, accountId: string) {
  const account = await prismaClient().integrationAccount.findUnique({
    where: { id: accountId },
    select: { clientId: true },
  });
  if (!account) throw new NotFoundError("Integration account not found");
  const ctx = await requirePermission(actor, account.clientId, "integration.view");
  const where = { integrationAccountId: accountId };
  const [
    contacts,
    opportunities,
    openOpportunities,
    pipelines,
    conversations,
    campaigns,
    workflows,
    socialPosts,
    socialAccounts,
    latestStat,
    lastSynced,
  ] = await Promise.all([
    ctx.db.crmContact.count({ where }),
    ctx.db.crmOpportunity.count({ where }),
    ctx.db.crmOpportunity.count({ where: { ...where, status: "open" } }),
    ctx.db.crmPipeline.count({ where }),
    ctx.db.crmConversation.count({ where }),
    ctx.db.crmAutomation.count({ where: { ...where, kind: "campaign" } }),
    ctx.db.crmAutomation.count({ where: { ...where, kind: "workflow" } }),
    ctx.db.providerSocialPost.count({ where }),
    ctx.db.providerSocialAccount.findMany({
      where,
      orderBy: { name: "asc" },
      select: { id: true, externalId: true, platform: true, name: true, isExpired: true },
    }),
    ctx.db.providerSocialStat.findFirst({
      where,
      orderBy: { capturedAt: "desc" },
      select: {
        capturedAt: true,
        windowDays: true,
        posts: true,
        likes: true,
        comments: true,
        followers: true,
        impressions: true,
      },
    }),
    ctx.db.syncRun.findFirst({
      where: { ...where, status: { in: ["succeeded", "partial"] } },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true, summary: true },
    }),
  ]);
  return {
    counts: {
      contacts,
      opportunities,
      openOpportunities,
      pipelines,
      conversations,
      campaigns,
      workflows,
      socialPosts,
    },
    socialAccounts,
    latestStat: latestStat ? { ...latestStat, impressions: Number(latestStat.impressions) } : null,
    lastSummary: (lastSynced?.summary ?? {}) as {
      unsupported?: { resource: string; reason: string }[];
      source?: string;
    },
    lastSuccessfulSyncAt: lastSynced?.finishedAt ?? null,
  };
}
