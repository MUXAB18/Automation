import { z } from "zod";
import { requirePermission, type Actor } from "../access";
import { recordAudit } from "../audit";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import type { Prisma } from "../generated/client";
import { getUnscopedPrisma } from "../unsafe";
import type { ProviderRecord, PersistTarget } from "./provider-data";

/**
 * SE Ranking data -> the platform's SEO tables. Provider ids and "se_ranking" source metadata are kept on
 * every row. Nothing is created twice: keywords, audits, competitors and issues are matched by provider
 * id (or adopted by their natural key), rank history is append-only and only gains a row when a reading
 * is new or revised, and backlink/summary readings are one per sync run.
 */

type Tx = Prisma.TransactionClient;
const prismaClient = () => getUnscopedPrisma();
const SOURCE = "se_ranking";

const num = z
  .number()
  .nullish()
  .transform((v) => v ?? null);
const str = z
  .string()
  .nullish()
  .transform((v) => v ?? null);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const projectData = z.object({
  name: str,
  title: str,
  providerActive: z.boolean().default(true),
  keywordCount: num,
  engines: z
    .array(
      z.object({
        siteEngineId: z.number(),
        searchEngineId: num,
        regionId: num,
        regionName: str,
        langCode: str,
      }),
    )
    .default([]),
});
const keywordData = z.object({
  siteId: z.string(),
  keywordExternalId: z.string(),
  term: z.string().min(1),
  targetUrl: str,
});
const rankingData = z.object({
  siteId: z.string(),
  keywordExternalId: z.string(),
  date: day,
  position: num,
  url: str,
  volume: num,
});
const summaryData = z.object({ siteId: z.string(), summary: z.record(z.string(), num) });
const competitorData = z.object({
  siteId: z.string(),
  competitorExternalId: z.string(),
  name: str,
  url: str,
  domainTrust: num,
});
const backlinkData = z.object({
  siteId: z.string(),
  total: num,
  domains: num,
  anchors: num,
  ip: num,
  dofollow: num,
  nofollow: num,
  remainingDailyAdds: num,
});
const auditData = z.object({
  siteId: z.string(),
  auditExternalId: z.string(),
  title: str,
  url: str,
  status: str,
  lastUpdate: str,
  score: num,
  errors: num,
  warnings: num,
  notices: num,
  crawled: num,
});
const issueData = z.object({
  siteId: z.string(),
  auditExternalId: z.string(),
  code: z.string().min(1),
  name: z.string(),
  section: str,
  status: z.string(),
  pagesAffected: num,
  sampleUrls: z.array(z.string()).default([]),
});
const reportData = z.object({
  siteId: z.string(),
  auditExternalId: z.string(),
  checks: num,
  score: num,
  pages: num,
});

const AUDIT_STATUS: Record<string, "queued" | "running" | "completed" | "failed" | "cancelled"> = {
  queued: "queued",
  processing: "running",
  finished: "completed",
  cancelled: "cancelled",
  expired: "failed",
};
const SEVERITY: Record<string, "low" | "medium" | "high"> = {
  notice: "low",
  warning: "medium",
  error: "high",
};

/** Lower-cased host without "www.", from a URL or bare domain. */
export function domainOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim().toLowerCase();
  try {
    const host = new URL(/^[a-z]+:\/\//.test(raw) ? raw : `https://${raw}`).hostname;
    return host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

const normalizeTerm = (term: string) => term.trim().replace(/\s+/g, " ").toLowerCase();

type Link = {
  id: string;
  seoProjectId: string;
  siteEngineId: number;
  name: string | null;
  country: string;
  locale: string;
  rankingsThrough: Date | null;
};

async function resolveLink(
  tx: Tx,
  accountId: string,
  siteId: string,
  cache: Map<string, Link | null>,
): Promise<Link | null> {
  if (cache.has(siteId)) return cache.get(siteId)!;
  const row = await tx.providerSeoProject.findUnique({
    where: {
      integrationAccountId_externalId: { integrationAccountId: accountId, externalId: siteId },
    },
    select: {
      id: true,
      seoProjectId: true,
      siteEngineId: true,
      syncEnabled: true,
      name: true,
      rankingsThrough: true,
      seoProject: { select: { targetCountry: true, targetLanguage: true } },
    },
  });
  const link: Link | null =
    row && row.syncEnabled && row.seoProjectId && row.siteEngineId !== null && row.seoProject
      ? {
          id: row.id,
          seoProjectId: row.seoProjectId,
          siteEngineId: row.siteEngineId,
          name: row.name,
          country: row.seoProject.targetCountry,
          locale: row.seoProject.targetLanguage,
          rankingsThrough: row.rankingsThrough,
        }
      : null;
  cache.set(siteId, link);
  return link;
}

/** Store one page of SE Ranking records. Returns how many were stored. Worker (system) use. */
export async function persistSeRankingRecords(
  target: PersistTarget,
  records: ProviderRecord[],
): Promise<number> {
  if (records.length === 0) return 0;
  return prismaClient().$transaction(async (tx) => {
    const base = { agencyId: target.agencyId, clientId: target.clientId };
    const cache = new Map<string, Link | null>();
    const by = (resource: string) => records.filter((r) => r.resource === resource);
    let written = 0;

    // Projects first: they create the link rows everything else resolves through.
    for (const r of by("projects")) {
      const d = projectData.parse(r.data);
      const common = {
        name: d.name,
        title: d.title,
        providerActive: d.providerActive,
        keywordCount: d.keywordCount === null ? null : Math.round(d.keywordCount),
        engines: d.engines as Prisma.InputJsonValue,
        syncedAt: new Date(),
      };
      await tx.providerSeoProject.upsert({
        where: {
          integrationAccountId_externalId: {
            integrationAccountId: target.accountId,
            externalId: r.externalId,
          },
        },
        create: {
          ...base,
          integrationAccountId: target.accountId,
          externalId: r.externalId,
          ...common,
        },
        update: common,
      });
      written++;
    }
    for (const r of by("project_missing")) {
      // The provider no longer has this project: stop syncing it so it cannot block the others.
      await tx.providerSeoProject.updateMany({
        where: { integrationAccountId: target.accountId, externalId: r.externalId },
        data: { providerActive: false, syncEnabled: false },
      });
      written++;
    }

    for (const r of by("keywords")) {
      const d = keywordData.parse(r.data);
      const link = await resolveLink(tx, target.accountId, d.siteId, cache);
      if (!link) continue;
      const term = normalizeTerm(d.term);
      const identity = {
        seoProjectId: link.seoProjectId,
        externalSource: SOURCE,
        externalId: d.keywordExternalId,
      };
      const byId = await tx.keyword.findFirst({ where: identity, select: { id: true } });
      if (byId) {
        await tx.keyword.update({
          where: { id: byId.id },
          data: { term, targetUrl: d.targetUrl ?? undefined, isActive: true },
        });
      } else {
        // A keyword someone already added by hand is adopted, not duplicated.
        const natural = await tx.keyword.findFirst({
          where: {
            seoProjectId: link.seoProjectId,
            term,
            country: link.country,
            locale: link.locale,
            device: "desktop",
          },
          select: { id: true, externalId: true },
        });
        if (natural && natural.externalId === null) {
          await tx.keyword.update({
            where: { id: natural.id },
            data: {
              externalSource: SOURCE,
              externalId: d.keywordExternalId,
              targetUrl: d.targetUrl ?? undefined,
            },
          });
        } else if (!natural) {
          await tx.keyword.create({
            data: {
              ...base,
              seoProjectId: link.seoProjectId,
              term,
              country: link.country,
              locale: link.locale,
              device: "desktop",
              targetUrl: d.targetUrl,
              externalSource: SOURCE,
              externalId: d.keywordExternalId,
            },
          });
        } else {
          continue; // same term already tracked from a different provider keyword: leave it alone
        }
      }
      written++;
    }

    written += await writeRankings(tx, target, by("rankings"), cache);

    for (const r of by("project_summary")) {
      const d = summaryData.parse(r.data);
      const link = await resolveLink(tx, target.accountId, d.siteId, cache);
      if (!link) continue;
      await tx.providerSeoProject.update({
        where: { id: link.id },
        data: { summary: d.summary as Prisma.InputJsonObject, summaryAt: new Date() },
      });
      written++;
    }

    for (const r of by("competitors")) {
      const d = competitorData.parse(r.data);
      const link = await resolveLink(tx, target.accountId, d.siteId, cache);
      const domain = domainOf(d.url) ?? domainOf(d.name);
      if (!link || !domain) continue;
      const providerData = { domainTrust: d.domainTrust, readAt: new Date().toISOString() };
      const identity = {
        seoProjectId: link.seoProjectId,
        externalSource: SOURCE,
        externalId: d.competitorExternalId,
      };
      const byId = await tx.competitor.findFirst({ where: identity, select: { id: true } });
      const byDomain = byId
        ? null
        : await tx.competitor.findUnique({
            where: { seoProjectId_domain: { seoProjectId: link.seoProjectId, domain } },
            select: { id: true, externalId: true },
          });
      if (byId)
        await tx.competitor.update({
          where: { id: byId.id },
          data: { name: d.name ?? undefined, providerData, isActive: true },
        });
      else if (byDomain && byDomain.externalId === null)
        await tx.competitor.update({
          where: { id: byDomain.id },
          data: {
            externalSource: SOURCE,
            externalId: d.competitorExternalId,
            name: d.name ?? undefined,
            providerData,
          },
        });
      else if (!byDomain)
        await tx.competitor.create({
          data: {
            ...base,
            seoProjectId: link.seoProjectId,
            domain,
            name: d.name,
            externalSource: SOURCE,
            externalId: d.competitorExternalId,
            providerData,
          },
        });
      else continue;
      written++;
    }

    for (const r of by("backlinks")) {
      const d = backlinkData.parse(r.data);
      const link = await resolveLink(tx, target.accountId, d.siteId, cache);
      const subject = domainOf(link?.name);
      // Totals the provider did not report are not stored as zero.
      if (!link || !subject || d.total === null) continue;
      const exists = await tx.backlinkSnapshot.findFirst({
        where: {
          syncRunId: target.syncRunId,
          seoProjectId: link.seoProjectId,
          subjectDomain: subject,
          source: SOURCE,
        },
        select: { id: true },
      });
      if (exists) continue;
      await tx.backlinkSnapshot.create({
        data: {
          ...base,
          seoProjectId: link.seoProjectId,
          syncRunId: target.syncRunId,
          source: SOURCE,
          subjectDomain: subject,
          totalBacklinks: Math.round(d.total),
          referringDomains: Math.round(d.domains ?? 0),
          raw: {
            anchors: d.anchors,
            ip: d.ip,
            dofollow: d.dofollow,
            nofollow: d.nofollow,
            remainingDailyAdds: d.remainingDailyAdds,
            referringDomainsReported: d.domains !== null,
          },
          capturedOn: new Date(new Date().toISOString().slice(0, 10)),
        },
      });
      written++;
    }

    for (const r of by("audits")) {
      const d = auditData.parse(r.data);
      const link = await resolveLink(tx, target.accountId, d.siteId, cache);
      if (!link) continue;
      await upsertAudit(tx, base, link.seoProjectId, d);
      written++;
    }

    for (const report of by("audit_reports")) {
      const rd = reportData.parse(report.data);
      const link = await resolveLink(tx, target.accountId, rd.siteId, cache);
      if (!link) continue;
      const issues = by("audit_issues")
        .map((r) => issueData.parse(r.data))
        .filter((i) => i.siteId === rd.siteId && i.auditExternalId === rd.auditExternalId);
      written += await writeIssues(tx, base, link.seoProjectId, rd, issues);
    }

    if (written > 0)
      await recordAudit(tx, {
        actorUserId: null,
        agencyId: target.agencyId,
        clientId: target.clientId,
        action: "integration.records_synced",
        entityType: "sync_run",
        entityId: target.syncRunId,
        after: { provider: SOURCE, written },
      });
    return written;
  });
}

async function writeRankings(
  tx: Tx,
  target: PersistTarget,
  records: ProviderRecord[],
  cache: Map<string, Link | null>,
): Promise<number> {
  if (records.length === 0) return 0;
  const bySite = new Map<string, z.infer<typeof rankingData>[]>();
  for (const r of records) {
    const d = rankingData.parse(r.data);
    bySite.set(d.siteId, [...(bySite.get(d.siteId) ?? []), d]);
  }
  let written = 0;
  for (const [siteId, rows] of bySite) {
    const link = await resolveLink(tx, target.accountId, siteId, cache);
    if (!link) continue;
    const keywords = await tx.keyword.findMany({
      where: {
        seoProjectId: link.seoProjectId,
        externalSource: SOURCE,
        externalId: { in: [...new Set(rows.map((r) => r.keywordExternalId))] },
      },
      select: { id: true, externalId: true },
    });
    const idOf = new Map(keywords.map((k) => [k.externalId!, k.id]));
    const dates = [...new Set(rows.map((r) => r.date))];
    // The latest reading already stored per keyword and day. A reading is only added when it is new or revised.
    const existing = await tx.keywordRankSnapshot.findMany({
      where: {
        keywordId: { in: keywords.map((k) => k.id) },
        source: SOURCE,
        checkedOn: { in: dates.map((d) => new Date(d)) },
      },
      orderBy: { capturedAt: "desc" },
      select: { keywordId: true, checkedOn: true, position: true },
    });
    const latest = new Map<string, number | null>();
    for (const e of existing) {
      const key = `${e.keywordId}|${e.checkedOn.toISOString().slice(0, 10)}`;
      if (!latest.has(key)) latest.set(key, e.position === null ? null : e.position.toNumber());
    }
    let maxDay: string | null = null;
    const volumes = new Map<string, { day: string; volume: number }>();
    for (const r of rows) {
      const keywordId = idOf.get(r.keywordExternalId);
      if (!keywordId) continue;
      if (!maxDay || r.date > maxDay) maxDay = r.date;
      if (r.volume !== null && (!volumes.get(keywordId) || r.date >= volumes.get(keywordId)!.day))
        volumes.set(keywordId, { day: r.date, volume: r.volume });
      const key = `${keywordId}|${r.date}`;
      if (latest.has(key) && latest.get(key) === r.position) continue;
      await tx.keywordRankSnapshot.create({
        data: {
          agencyId: target.agencyId,
          clientId: target.clientId,
          keywordId,
          syncRunId: target.syncRunId,
          source: SOURCE,
          checkedOn: new Date(r.date),
          position: r.position,
          url: r.url,
        },
      });
      latest.set(key, r.position);
      written++;
    }
    for (const [keywordId, v] of volumes)
      await tx.keyword.update({
        where: { id: keywordId },
        data: { searchVolume: Math.round(v.volume), volumeUpdatedAt: new Date() },
      });
    if (
      maxDay &&
      (!link.rankingsThrough || maxDay > link.rankingsThrough.toISOString().slice(0, 10))
    )
      await tx.providerSeoProject.update({
        where: { id: link.id },
        data: { rankingsThrough: new Date(maxDay) },
      });
  }
  return written;
}

async function upsertAudit(
  tx: Tx,
  base: { agencyId: string; clientId: string },
  seoProjectId: string,
  d: z.infer<typeof auditData>,
) {
  const status = AUDIT_STATUS[d.status ?? ""] ?? "running";
  const finishedAt = status === "completed" && d.lastUpdate ? new Date(d.lastUpdate) : null;
  const data = {
    status,
    pagesCrawled: Math.round(d.crawled ?? 0),
    healthScore: d.score,
    finishedAt: finishedAt && !Number.isNaN(finishedAt.getTime()) ? finishedAt : null,
    summary: {
      source: SOURCE,
      errors: d.errors,
      warnings: d.warnings,
      notices: d.notices,
      title: d.title,
      url: d.url,
      providerStatus: d.status,
    } as Prisma.InputJsonObject,
  };
  const identity = { seoProjectId, externalSource: SOURCE, externalId: d.auditExternalId };
  const existing = await tx.siteAudit.findFirst({ where: identity, select: { id: true } });
  if (existing) return tx.siteAudit.update({ where: { id: existing.id }, data });
  return tx.siteAudit.create({ data: { ...base, ...identity, ...data } });
}

async function writeIssues(
  tx: Tx,
  base: { agencyId: string; clientId: string },
  seoProjectId: string,
  report: z.infer<typeof reportData>,
  checks: z.infer<typeof issueData>[],
): Promise<number> {
  let audit = await tx.siteAudit.findFirst({
    where: { seoProjectId, externalSource: SOURCE, externalId: report.auditExternalId },
    select: { id: true },
  });
  audit ??= await tx.siteAudit.create({
    data: {
      ...base,
      seoProjectId,
      externalSource: SOURCE,
      externalId: report.auditExternalId,
      status: "completed",
      pagesCrawled: Math.round(report.pages ?? 0),
      healthScore: report.score,
      summary: { source: SOURCE },
    },
  });
  const now = new Date();
  let written = 0;
  const reported = new Set<string>();

  for (const c of checks) {
    if (c.status === "passed" || !SEVERITY[c.status]) continue;
    const fingerprint = `${SOURCE}:${c.code}`;
    reported.add(fingerprint);
    const details = {
      source: SOURCE,
      section: c.section,
      pagesAffected: c.pagesAffected,
      sampleUrls: c.sampleUrls,
      auditExternalId: report.auditExternalId,
    } as Prisma.InputJsonObject;
    const existing = await tx.seoIssue.findUnique({
      where: { seoProjectId_fingerprint: { seoProjectId, fingerprint } },
      select: { id: true, status: true },
    });
    if (!existing) {
      const issue = await tx.seoIssue.create({
        data: {
          ...base,
          seoProjectId,
          ruleKey: c.code,
          fingerprint,
          severity: SEVERITY[c.status]!,
          status: "open",
          title: c.name,
          externalSource: SOURCE,
          details,
          firstSeenAuditId: audit.id,
          lastSeenAuditId: audit.id,
          firstSeenAt: now,
          lastSeenAt: now,
        },
        select: { id: true },
      });
      await tx.seoIssueHistory.create({
        data: {
          ...base,
          seoIssueId: issue.id,
          auditId: audit.id,
          fromStatus: null,
          toStatus: "open",
          note: "First reported by the SE Ranking site audit",
        },
      });
    } else {
      // A person's decision (acknowledged, in progress, ignored) is kept; only a fixed issue that came back is reopened.
      const reopen = existing.status === "fixed";
      await tx.seoIssue.update({
        where: { id: existing.id },
        data: {
          severity: SEVERITY[c.status]!,
          title: c.name,
          details,
          lastSeenAuditId: audit.id,
          lastSeenAt: now,
          ...(reopen ? { status: "reopened", resolvedAt: null } : {}),
        },
      });
      if (reopen)
        await tx.seoIssueHistory.create({
          data: {
            ...base,
            seoIssueId: existing.id,
            auditId: audit.id,
            fromStatus: "fixed",
            toStatus: "reopened",
            note: "Reported again by the SE Ranking site audit",
          },
        });
    }
    written++;
  }

  // Resolve what the latest finished audit no longer reports. An empty report never resolves anything.
  if ((report.checks ?? 0) > 0) {
    const gone = await tx.seoIssue.findMany({
      where: {
        seoProjectId,
        externalSource: SOURCE,
        status: { in: ["open", "reopened", "acknowledged", "in_progress"] },
        fingerprint: { notIn: [...reported] },
      },
      select: { id: true, status: true },
    });
    for (const issue of gone) {
      await tx.seoIssue.update({
        where: { id: issue.id },
        data: { status: "fixed", resolvedAt: now, lastSeenAuditId: audit.id },
      });
      await tx.seoIssueHistory.create({
        data: {
          ...base,
          seoIssueId: issue.id,
          auditId: audit.id,
          fromStatus: issue.status,
          toStatus: "fixed",
          note: "No longer reported by the latest SE Ranking site audit",
        },
      });
      written++;
    }
  }
  return written;
}

// ---- Worker: what to sync -------------------------------------------------------------------------

/** The linked, enabled projects the adapter should sync for an account. */
export async function loadSeRankingSettings(accountId: string) {
  const rows = await prismaClient().providerSeoProject.findMany({
    where: {
      integrationAccountId: accountId,
      syncEnabled: true,
      providerActive: true,
      seoProjectId: { not: null },
      siteEngineId: { not: null },
    },
    select: { externalId: true, siteEngineId: true, rankingsThrough: true },
    orderBy: { externalId: "asc" },
  });
  return {
    projects: rows.map((r) => ({
      siteId: r.externalId,
      siteEngineId: r.siteEngineId!,
      rankingsThrough: r.rankingsThrough ? r.rankingsThrough.toISOString().slice(0, 10) : null,
    })),
  };
}

// ---- Linking (people) -----------------------------------------------------------------------------

async function loadProviderProject(id: string) {
  const row = await prismaClient().providerSeoProject.findUnique({
    where: { id },
    select: {
      id: true,
      clientId: true,
      agencyId: true,
      engines: true,
      seoProjectId: true,
      syncEnabled: true,
      name: true,
    },
  });
  if (!row) throw new NotFoundError("Project not found");
  return row;
}

/** Discovered projects of an account, with what can be linked. Needs integration.view. */
export async function listProviderSeoProjects(actor: Actor, accountId: string) {
  const account = await prismaClient().integrationAccount.findUnique({
    where: { id: accountId },
    select: { clientId: true },
  });
  if (!account) throw new NotFoundError("Integration account not found");
  const ctx = await requirePermission(actor, account.clientId, "integration.view");
  const [projects, candidates] = await Promise.all([
    ctx.db.providerSeoProject.findMany({
      where: { integrationAccountId: accountId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        externalId: true,
        name: true,
        title: true,
        providerActive: true,
        keywordCount: true,
        engines: true,
        siteEngineId: true,
        seoProjectId: true,
        syncEnabled: true,
        syncedAt: true,
        rankingsThrough: true,
        seoProject: { select: { id: true, project: { select: { name: true } } } },
      },
    }),
    ctx.db.seoProject.findMany({
      where: { clientId: account.clientId, providerLink: null, status: { not: "archived" } },
      select: {
        id: true,
        project: { select: { name: true } },
        website: { select: { domain: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return {
    projects: projects.map((p) => ({
      ...p,
      engines: (p.engines ?? []) as {
        siteEngineId: number;
        regionName: string | null;
        langCode: string | null;
      }[],
    })),
    candidates: candidates.map((c) => ({
      id: c.id,
      name: c.project.name,
      domain: c.website.domain,
    })),
    canLink: await requirePermission(actor, account.clientId, "integration.manage")
      .then(() => requirePermission(actor, account.clientId, "seo.manage"))
      .then(() => true)
      .catch(() => false),
  };
}

const linkSchema = z.object({
  providerProjectId: z.uuid(),
  seoProjectId: z.uuid(),
  siteEngineId: z.number().int(),
});

/** Link a discovered project to a platform SEO project and start syncing it. Needs integration.manage and seo.manage. */
export async function linkProviderSeoProject(actor: Actor, raw: z.input<typeof linkSchema>) {
  const parsed = linkSchema.safeParse(raw);
  if (!parsed.success)
    throw new ValidationError(
      Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), [i.message]])),
    );
  const input = parsed.data;
  const row = await loadProviderProject(input.providerProjectId);
  await requirePermission(actor, row.clientId, "integration.manage");
  const ctx = await requirePermission(actor, row.clientId, "seo.manage");
  const engines = (row.engines ?? []) as { siteEngineId: number }[];
  if (!engines.some((e) => e.siteEngineId === input.siteEngineId))
    throw new ValidationError({ siteEngineId: ["Choose one of the project's search engines"] });
  const seo = await ctx.db.seoProject.findFirst({
    where: { id: input.seoProjectId, clientId: row.clientId },
    select: { id: true },
  });
  if (!seo) throw new NotFoundError("SEO project not found");
  return prismaClient().$transaction(async (tx) => {
    try {
      await tx.providerSeoProject.update({
        where: { id: row.id },
        // A new link starts its ranking history from scratch (the first sync reads the backfill window).
        data: {
          seoProjectId: seo.id,
          siteEngineId: input.siteEngineId,
          syncEnabled: true,
          rankingsThrough: null,
          linkedById: actor.userId,
          linkedAt: new Date(),
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002")
        throw new ConflictError("That SEO project is already linked to another SE Ranking project");
      throw error;
    }
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: row.agencyId,
      clientId: row.clientId,
      action: "seranking.project_linked",
      entityType: "provider_seo_project",
      entityId: row.id,
      after: { seoProjectId: seo.id, siteEngineId: input.siteEngineId },
    });
  });
}

/** Stop syncing a project. Everything already imported stays. */
export async function unlinkProviderSeoProject(actor: Actor, providerProjectId: string) {
  const row = await loadProviderProject(providerProjectId);
  await requirePermission(actor, row.clientId, "integration.manage");
  await prismaClient().$transaction(async (tx) => {
    await tx.providerSeoProject.update({
      where: { id: row.id },
      data: { seoProjectId: null, siteEngineId: null, syncEnabled: false },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: row.agencyId,
      clientId: row.clientId,
      action: "seranking.project_unlinked",
      entityType: "provider_seo_project",
      entityId: row.id,
      before: { seoProjectId: row.seoProjectId },
    });
  });
}
