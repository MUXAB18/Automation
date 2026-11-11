import { z } from "zod";
import { requirePermission, type Actor } from "../access";
import { recordAudit } from "../audit";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import type { Prisma } from "../generated/client";
import { METRIC_CATALOGUE, METRIC_KEYS } from "../metrics";
import { getUnscopedPrisma } from "../unsafe";
import type { PersistTarget, ProviderRecord } from "./provider-data";

/**
 * Google Analytics 4 and Search Console data -> analytics_sources and append-only metric_snapshots.
 * A snapshot is only added when a value is new, changed, or became final, so repeated syncs never
 * duplicate history and revised numbers keep their earlier readings.
 */

type Tx = Prisma.TransactionClient;
const prismaClient = () => getUnscopedPrisma();

const num = z.number().nullable();
const propertyData = z.object({
  kind: z.enum(["ga4", "search_console"]),
  displayName: z.string().nullish(),
  accountName: z.string().nullish(),
  propertyType: z.string().nullish(),
  permissionLevel: z.string().nullish(),
  mock: z.boolean().optional(),
});
const problemData = z.object({
  sourceKey: z.string(),
  kind: z.enum(["ga4", "search_console"]),
  code: z.string(),
  message: z.string(),
});
const metricsData = z.object({
  sourceKey: z.string(),
  kind: z.enum(["ga4", "search_console"]),
  set: z.string(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dimensions: z.record(z.string(), z.string()),
  values: z.record(z.string(), num),
  isFinal: z.boolean(),
});

/** Canonical "key=value|key=value" (sorted) form of a dimension set; '' for none. */
export const dimensionKeyOf = (dimensions: Record<string, string>) =>
  Object.entries(dimensions)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("|");

let catalogueEnsured = false;
async function metricIds(tx: Tx): Promise<Map<string, string>> {
  if (!catalogueEnsured) {
    for (const m of METRIC_CATALOGUE)
      await tx.metricDefinition.upsert({
        where: { key: m.key },
        create: {
          key: m.key,
          name: m.name,
          description: m.description,
          sourceKind: m.sourceKind,
          unit: m.unit,
          aggregation: m.aggregation,
        },
        update: {},
      });
  }
  const rows = await tx.metricDefinition.findMany({ select: { id: true, key: true } });
  catalogueEnsured = rows.length >= METRIC_CATALOGUE.length;
  return new Map(rows.map((r) => [r.key, r.id]));
}
/** Tests wipe the catalogue between runs. */
export const _resetMetricCatalogueCache = () => {
  catalogueEnsured = false;
};

export async function persistGoogleRecords(
  target: PersistTarget,
  records: ProviderRecord[],
): Promise<number> {
  if (records.length === 0) return 0;
  return prismaClient().$transaction(async (tx) => {
    const base = { agencyId: target.agencyId, clientId: target.clientId };
    let written = 0;

    for (const r of records.filter((x) => x.resource === "properties")) {
      const d = propertyData.parse(r.data);
      const meta = {
        permissionLevel: d.permissionLevel ?? null,
        propertyType: d.propertyType ?? null,
        accountName: d.accountName ?? null,
        mock: d.mock === true,
      };
      const existing = await tx.analyticsSource.findUnique({
        where: {
          integrationAccountId_externalId: {
            integrationAccountId: target.accountId,
            externalId: r.externalId,
          },
        },
        select: { id: true, metadata: true },
      });
      if (existing) {
        await tx.analyticsSource.update({
          where: { id: existing.id },
          data: {
            displayName: d.displayName ?? undefined,
            metadata: { ...(existing.metadata as object), ...meta },
          },
        });
      } else {
        // Discovered, not selected: a person chooses which properties are synced.
        await tx.analyticsSource.create({
          data: {
            ...base,
            integrationAccountId: target.accountId,
            kind: d.kind,
            externalId: r.externalId,
            displayName: d.displayName ?? r.externalId,
            isActive: false,
            metadata: meta,
          },
        });
      }
      written++;
    }

    for (const r of records.filter((x) => x.resource === "source_problem")) {
      const d = problemData.parse(r.data);
      const src = await tx.analyticsSource.findUnique({
        where: {
          integrationAccountId_externalId: {
            integrationAccountId: target.accountId,
            externalId: d.sourceKey,
          },
        },
        select: { id: true, metadata: true },
      });
      if (!src) continue;
      await tx.analyticsSource.update({
        where: { id: src.id },
        data: {
          metadata: {
            ...(src.metadata as object),
            problem: {
              code: d.code,
              message: d.message.slice(0, 300),
              at: new Date().toISOString(),
            },
          },
        },
      });
      written++;
    }

    const metrics = records
      .filter((x) => x.resource === "metrics")
      .map((x) => metricsData.parse(x.data));
    if (metrics.length > 0) written += await writeMetrics(tx, target, metrics);

    if (written > 0)
      await recordAudit(tx, {
        actorUserId: null,
        agencyId: target.agencyId,
        clientId: target.clientId,
        action: "integration.records_synced",
        entityType: "sync_run",
        entityId: target.syncRunId,
        after: { provider: "google", written },
      });
    return written;
  });
}

async function writeMetrics(
  tx: Tx,
  target: PersistTarget,
  rows: z.infer<typeof metricsData>[],
): Promise<number> {
  const ids = await metricIds(tx);
  let written = 0;
  const bySource = new Map<string, typeof rows>();
  for (const r of rows) bySource.set(r.sourceKey, [...(bySource.get(r.sourceKey) ?? []), r]);

  for (const [sourceKey, list] of bySource) {
    const source = await tx.analyticsSource.findUnique({
      where: {
        integrationAccountId_externalId: {
          integrationAccountId: target.accountId,
          externalId: sourceKey,
        },
      },
      select: { id: true, isActive: true, dataThrough: true, metadata: true },
    });
    if (!source || !source.isActive) continue; // not selected: nothing is stored
    const days = [...new Set(list.map((r) => r.day))];
    const keys = [...new Set(list.flatMap((r) => Object.keys(r.values)))].filter((k) => ids.has(k));
    const existing = await tx.metricSnapshot.findMany({
      where: {
        analyticsSourceId: source.id,
        periodStart: { in: days.map((d) => new Date(d)) },
        metricDefinitionId: { in: keys.map((k) => ids.get(k)!) },
      },
      orderBy: { capturedAt: "desc" },
      select: {
        metricDefinitionId: true,
        periodStart: true,
        dimensionKey: true,
        value: true,
        isFinal: true,
      },
    });
    const latest = new Map<string, { value: number; isFinal: boolean }>();
    for (const e of existing) {
      const k = `${e.metricDefinitionId}|${e.periodStart.toISOString().slice(0, 10)}|${e.dimensionKey}`;
      if (!latest.has(k)) latest.set(k, { value: e.value.toNumber(), isFinal: e.isFinal });
    }
    const inserts: Prisma.MetricSnapshotCreateManyInput[] = [];
    let maxFinalTotalsDay: string | null = null;
    for (const r of list) {
      const dimensionKey = dimensionKeyOf(r.dimensions);
      if (r.set === "totals" && r.isFinal && (!maxFinalTotalsDay || r.day > maxFinalTotalsDay))
        maxFinalTotalsDay = r.day;
      for (const [key, value] of Object.entries(r.values)) {
        const metricId = ids.get(key);
        // Unknown metric keys and values Google did not report are not stored (never as zero).
        if (!metricId || value === null || !METRIC_KEYS.has(key)) continue;
        const prev = latest.get(`${metricId}|${r.day}|${dimensionKey}`);
        if (prev && prev.value === value && (prev.isFinal || !r.isFinal)) continue;
        inserts.push({
          ...{ agencyId: target.agencyId, clientId: target.clientId },
          analyticsSourceId: source.id,
          metricDefinitionId: metricId,
          syncRunId: target.syncRunId,
          granularity: "day",
          periodStart: new Date(r.day),
          dimensionKey,
          dimensions: r.dimensions,
          value,
          isFinal: r.isFinal,
        });
      }
    }
    if (inserts.length > 0) {
      const res = await tx.metricSnapshot.createMany({ data: inserts, skipDuplicates: true });
      written += res.count;
    }
    const meta = { ...(source.metadata as { problem?: unknown }) };
    delete meta.problem; // data arrived: any earlier access problem is over
    await tx.analyticsSource.update({
      where: { id: source.id },
      data: {
        lastSyncedAt: new Date(),
        metadata: meta as Prisma.InputJsonObject,
        ...(maxFinalTotalsDay &&
        (!source.dataThrough || new Date(maxFinalTotalsDay) > source.dataThrough)
          ? { dataThrough: new Date(maxFinalTotalsDay) }
          : {}),
      },
    });
  }
  return written;
}

// ---- Worker: what to sync ----------------------------------------------------------------------------------

export async function loadGoogleSettings(accountId: string) {
  const rows = await prismaClient().analyticsSource.findMany({
    where: { integrationAccountId: accountId, isActive: true },
    select: { externalId: true, dataThrough: true },
    orderBy: { externalId: "asc" },
  });
  return {
    sources: rows.map((r) => ({
      externalId: r.externalId,
      dataThrough: r.dataThrough ? r.dataThrough.toISOString().slice(0, 10) : null,
    })),
  };
}

// ---- Property setup (people) -------------------------------------------------------------------------------

export type SourceMeta = {
  permissionLevel?: string | null;
  propertyType?: string | null;
  accountName?: string | null;
  mock?: boolean;
  problem?: { code: string; message: string; at: string };
};

export async function listAnalyticsSources(actor: Actor, accountId: string) {
  const account = await prismaClient().integrationAccount.findUnique({
    where: { id: accountId },
    select: { clientId: true },
  });
  if (!account) throw new NotFoundError("Integration account not found");
  const ctx = await requirePermission(actor, account.clientId, "integration.view");
  const [sources, websites] = await Promise.all([
    ctx.db.analyticsSource.findMany({
      where: { integrationAccountId: accountId },
      orderBy: [{ isActive: "desc" }, { displayName: "asc" }],
      select: {
        id: true,
        kind: true,
        externalId: true,
        displayName: true,
        isActive: true,
        lastSyncedAt: true,
        dataThrough: true,
        websiteId: true,
        metadata: true,
        website: { select: { domain: true } },
      },
    }),
    ctx.db.website.findMany({
      where: { clientId: account.clientId },
      select: { id: true, domain: true },
      orderBy: { domain: "asc" },
    }),
  ]);
  const canManage = await requirePermission(actor, account.clientId, "integration.manage")
    .then(() => true)
    .catch(() => false);
  return {
    sources: sources.map((s) => ({ ...s, metadata: (s.metadata ?? {}) as SourceMeta })),
    websites,
    canManage,
  };
}

const selectionSchema = z.object({
  sourceId: z.uuid(),
  active: z.boolean(),
  websiteId: z.uuid().nullish(),
});

/** Choose whether a discovered property is synced, and which of the client's websites it belongs to. */
export async function setAnalyticsSourceSelection(
  actor: Actor,
  raw: z.input<typeof selectionSchema>,
) {
  const parsed = selectionSchema.safeParse(raw);
  if (!parsed.success)
    throw new ValidationError(
      Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), [i.message]])),
    );
  const input = parsed.data;
  const source = await prismaClient().analyticsSource.findUnique({
    where: { id: input.sourceId },
    select: {
      id: true,
      clientId: true,
      agencyId: true,
      kind: true,
      isActive: true,
      metadata: true,
    },
  });
  if (!source) throw new NotFoundError("Property not found");
  const ctx = await requirePermission(actor, source.clientId, "integration.manage");
  if (input.active && (source.metadata as SourceMeta).permissionLevel === "siteUnverifiedUser")
    throw new ConflictError(
      "This Search Console property is not verified for the connected account, so Google returns no data for it",
    );
  if (input.websiteId) {
    const site = await ctx.db.website.findFirst({
      where: { id: input.websiteId, clientId: source.clientId },
      select: { id: true },
    });
    if (!site) throw new ValidationError({ websiteId: ["Choose one of this client's websites"] });
  }
  await prismaClient().$transaction(async (tx) => {
    await tx.analyticsSource.update({
      where: { id: source.id },
      data: {
        isActive: input.active,
        websiteId: input.websiteId === undefined ? undefined : input.websiteId,
      },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: source.agencyId,
      clientId: source.clientId,
      action: input.active ? "analytics.source_selected" : "analytics.source_deselected",
      entityType: "analytics_source",
      entityId: source.id,
      before: { isActive: source.isActive },
      after: { isActive: input.active, websiteId: input.websiteId ?? null },
    });
  });
}
