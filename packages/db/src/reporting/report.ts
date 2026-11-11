import { z } from "zod";
import {
  clientIdsWith,
  forClients,
  getAccessMap,
  listUsersWithPermission,
  requireAgencyPermission,
  requirePermission,
  type Actor,
} from "../access";
import { recordAudit } from "../audit";
import { executeAiJob } from "../ai/runner";
import type { AiProvider, AiRuntimeConfig } from "../ai/provider";
import { getAiUsage } from "../ai/service";
import { promptVersion } from "../ai/templates";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import type { Prisma } from "../generated/client";
import { PAGE_SIZE, clampPage, paged } from "../services/paging";
import { getUnscopedPrisma } from "../unsafe";
import {
  DEFAULT_LAYOUT,
  SECTION_KEYS,
  SECTION_TITLE,
  hashData,
  periodLabel,
  templateLayoutSchema,
  validateAll,
  type Recommendation,
  type ReportView,
  type SectionKey,
  type TemplateLayout,
} from "./document";
import {
  addDays,
  collectMetrics,
  daysBetween,
  ymd,
  type Metric,
  type MetricsResult,
} from "./metrics";
import { DEFAULT_INTERVAL_DAYS, lastFullPeriod } from "./periods";
import { zonedDay } from "../time-zone";

const prisma = () => getUnscopedPrisma();
const isUnique = (e: unknown) => (e as { code?: string }).code === "P2002";

// ---- Wording from facts ---------------------------------------------------------------------------------------------

const fmt = (m: Metric, digits = 0) =>
  m.value === null
    ? null
    : m.unit === "percent"
      ? `${m.value.toFixed(digits || 1)}%`
      : m.unit === "position"
        ? m.value.toFixed(1)
        : m.value.toLocaleString("en-CA", { maximumFractionDigits: digits });
const delta = (m: Metric) =>
  m.changePct === null
    ? ""
    : ` (${m.changePct >= 0 ? "up" : "down"} ${Math.abs(m.changePct).toFixed(0)}% on the previous period)`;

/** Every figure the summary may rely on: label and number, taken from validated metrics only. */
export function factsOf(m: MetricsResult): { label: string; value: number }[] {
  const all: Metric[] = [
    m.search.clicks,
    m.search.impressions,
    m.search.ctr,
    m.search.position,
    m.traffic.sessions,
    m.traffic.organicSessions,
    m.traffic.engagedSessions,
    m.traffic.engagementRate,
    m.traffic.keyEvents,
    m.social.published,
    m.work.completed,
    m.work.issuesResolved,
    m.work.issuesOpenTotal,
  ];
  const facts = all
    .filter((x) => x.value !== null && x.state !== "no_data" && x.state !== "no_source")
    .map((x) => ({ label: x.label, value: Math.round(x.value! * 100) / 100 }));
  if (m.rankings.withChange > 0)
    facts.push(
      { label: "Keywords moved up", value: m.rankings.improved },
      { label: "Keywords moved down", value: m.rankings.declined },
    );
  return facts;
}

/** The fixed-wording summary: states only what the data says, and says plainly what is missing. */
export function deterministicSummary(
  m: MetricsResult,
  clientName: string,
  start: string,
  end: string,
): string {
  const parts: string[] = [`This report covers ${periodLabel(start, end)} for ${clientName}.`];
  const clicks = fmt(m.search.clicks),
    imp = fmt(m.search.impressions);
  if (clicks && imp)
    parts.push(
      `Search Console recorded ${clicks} organic clicks from ${imp} impressions${delta(m.search.clicks)}, with an average position of ${fmt(m.search.position) ?? "not available"}.`,
    );
  else parts.push("Search Console data is not available for this period.");
  const sessions = fmt(m.traffic.sessions);
  if (sessions)
    parts.push(
      `Google Analytics recorded ${sessions} sessions${delta(m.traffic.sessions)}${fmt(m.traffic.organicSessions) ? `, of which ${fmt(m.traffic.organicSessions)} came from organic search` : ""}.`,
    );
  else parts.push("Google Analytics data is not available for this period.");
  if (m.rankings.withChange > 0)
    parts.push(
      `Of ${m.rankings.withChange} tracked keywords with a comparison, ${m.rankings.improved} moved up and ${m.rankings.declined} moved down.`,
    );
  parts.push(
    m.social.published.value
      ? `${m.social.published.value} social post${m.social.published.value === 1 ? " was" : "s were"} published.`
      : "No social posts were published in this period.",
  );
  parts.push(
    `${m.work.completed.value ?? 0} task${m.work.completed.value === 1 ? " was" : "s were"} completed and ${m.work.issuesResolved.value ?? 0} SEO issue${m.work.issuesResolved.value === 1 ? " was" : "s were"} resolved.`,
  );
  return parts.join(" ");
}

/** Recommendations derived by fixed rules from the figures. Each says which figure it rests on; none predicts a result. */
export function recommendationsFrom(m: MetricsResult): Recommendation[] {
  const out: Recommendation[] = [];
  const o = m.work.issuesOpen;
  if (o.critical + o.high > 0)
    out.push({
      title: `Fix the ${o.critical + o.high} critical and high-severity SEO issues`,
      reason: `${o.critical} critical and ${o.high} high-severity issues are open.`,
    });
  if (m.rankings.declined > 0 && m.rankings.declined >= m.rankings.improved) {
    const top = m.rankings.topDeclined[0];
    out.push({
      title: "Review the keywords that lost positions",
      reason: `${m.rankings.declined} tracked keywords moved down and ${m.rankings.improved} moved up${top ? `; the largest drop is "${top.term}" (${top.from.toFixed(1)} to ${top.to.toFixed(1)})` : ""}.`,
    });
  }
  if (m.search.clicks.changePct !== null && m.search.clicks.changePct <= -15)
    out.push({
      title: "Investigate the fall in organic clicks",
      reason: `Organic clicks are down ${Math.abs(m.search.clicks.changePct).toFixed(0)}% on the previous period.`,
    });
  if (
    m.search.ctr.value !== null &&
    m.search.impressions.value !== null &&
    m.search.impressions.value >= 1000 &&
    m.search.ctr.value < 2
  )
    out.push({
      title: "Improve titles and meta descriptions on high-impression pages",
      reason: `The click-through rate is ${m.search.ctr.value.toFixed(1)}% on ${m.search.impressions.value.toLocaleString("en-CA")} impressions.`,
    });
  if (m.social.published.value === 0)
    out.push({
      title: "Plan social content for the next period",
      reason: "No posts were published in this period.",
    });
  if (m.search.clicks.state === "no_source")
    out.push({
      title: "Connect Google Search Console",
      reason: "Without it the report has no search performance data.",
    });
  if (m.traffic.sessions.state === "no_source")
    out.push({
      title: "Connect Google Analytics",
      reason: "Without it the report has no website traffic data.",
    });
  for (const f of m.freshness)
    if (f.stale && !f.mock)
      out.push({
        title: `Refresh stale data: ${f.label}`,
        reason: f.dataThrough
          ? `The newest data is from ${f.dataThrough}.`
          : "No data has been synced yet.",
      });
  for (const i of m.integrations)
    if (["error", "needs_reauth"].includes(i.status))
      out.push({
        title: `Reconnect ${i.provider}`,
        reason: `The connection is "${i.status.replace("_", " ")}", so its data may be out of date.`,
      });
  return out.slice(0, 8);
}

const renderTitle = (pattern: string, client: string, start: string, end: string) =>
  pattern
    .replace(/\{\{client\}\}/g, client)
    .replace(/\{\{period\}\}/g, periodLabel(start, end))
    .slice(0, 200);

// ---- Templates ------------------------------------------------------------------------------------------------------

export async function ensureDefaultTemplate(agencyId: string) {
  const found = await prisma().reportTemplate.findFirst({
    where: { agencyId, isDefault: true, archivedAt: null },
  });
  if (found) return found;
  try {
    return await prisma().reportTemplate.create({
      data: {
        agencyId,
        slug: "default",
        name: "Standard report",
        description:
          "Summary, SEO, search and traffic, social, work, issues, recommendations and data sources.",
        layout: DEFAULT_LAYOUT as Prisma.InputJsonObject,
        isDefault: true,
      },
    });
  } catch (error) {
    if (!isUnique(error)) throw error;
    return prisma().reportTemplate.findFirstOrThrow({ where: { agencyId, slug: "default" } });
  }
}

export function parseLayout(raw: unknown): TemplateLayout {
  const p = templateLayoutSchema.safeParse(raw);
  return p.success ? p.data : DEFAULT_LAYOUT;
}

export async function getReportTemplate(actor: Actor, agencyId: string) {
  await requireAgencyPermission(actor, agencyId, "agency.manage");
  const t = await ensureDefaultTemplate(agencyId);
  return { id: t.id, name: t.name, version: t.version, layout: parseLayout(t.layout) };
}

export async function saveReportTemplate(
  actor: Actor,
  agencyId: string,
  input: {
    sections: { key: string; enabled: boolean }[];
    defaultIntervalDays: number;
    useAi: boolean;
    titlePattern: string;
  },
) {
  await requireAgencyPermission(actor, agencyId, "agency.manage");
  const parsed = templateLayoutSchema.safeParse(input);
  if (!parsed.success)
    throw new ValidationError(
      Object.fromEntries(parsed.error.issues.map((i) => [i.path.join(".") || "form", [i.message]])),
    );
  if (!parsed.data.sections.some((s) => s.enabled))
    throw new ValidationError({ sections: ["Keep at least one section"] });
  // Sections keep their fixed order; the template only chooses which appear.
  const order = new Map(SECTION_KEYS.map((k, i) => [k, i]));
  parsed.data.sections.sort((a, b) => order.get(a.key)! - order.get(b.key)!);
  const t = await ensureDefaultTemplate(agencyId);
  await prisma().$transaction(async (tx) => {
    await tx.reportTemplate.update({
      where: { id: t.id },
      data: { layout: parsed.data as Prisma.InputJsonObject, version: { increment: 1 } },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId,
      clientId: null,
      action: "report.template_saved",
      entityType: "report_template",
      entityId: t.id,
      after: { sections: parsed.data.sections.filter((s) => s.enabled).length },
    });
  });
}

// ---- Requesting ------------------------------------------------------------------------------------------------------

const requestSchema = z.object({
  clientId: z.uuid(),
  periodStart: z.iso.date().optional(),
  periodEnd: z.iso.date().optional(),
});

export type NewReport = {
  agencyId: string;
  clientId: string;
  start: string;
  end: string;
  source: "manual" | "scheduled";
  createdById: string | null;
};

/** Create the report row (status generating). Returns the open one when the same period is already being generated. */
export async function createReportRecord(n: NewReport): Promise<{ id: string; created: boolean }> {
  const template = await ensureDefaultTemplate(n.agencyId);
  const layout = parseLayout(template.layout);
  const client = await prisma().client.findUniqueOrThrow({
    where: { id: n.clientId },
    select: { name: true },
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    const latest = await prisma().report.findFirst({
      where: {
        clientId: n.clientId,
        periodStart: new Date(`${n.start}T00:00:00Z`),
        periodEnd: new Date(`${n.end}T00:00:00Z`),
      },
      orderBy: { revision: "desc" },
      select: { id: true, revision: true, status: true },
    });
    if (latest && n.source === "scheduled") return { id: latest.id, created: false }; // the schedule never makes a second revision
    if (latest && latest.status === "generating") return { id: latest.id, created: false };
    try {
      const r = await prisma().report.create({
        data: {
          agencyId: n.agencyId,
          clientId: n.clientId,
          templateId: template.id,
          templateVersion: template.version,
          title: renderTitle(layout.titlePattern, client.name, n.start, n.end),
          periodStart: new Date(`${n.start}T00:00:00Z`),
          periodEnd: new Date(`${n.end}T00:00:00Z`),
          revision: (latest?.revision ?? 0) + 1,
          status: "generating",
          source: n.source,
          createdById: n.createdById,
        },
        select: { id: true },
      });
      return { id: r.id, created: true };
    } catch (error) {
      if (!isUnique(error)) throw error; // another request created it first: look again
    }
  }
  throw new ConflictError("The report is already being created. Try again in a moment.");
}

export async function requestReport(
  actor: Actor,
  raw: z.input<typeof requestSchema>,
  now = new Date(),
) {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError({ clientId: ["Choose a client"] });
  const ctx = await requirePermission(actor, parsed.data.clientId, "report.generate");
  const client = await prisma().client.findUniqueOrThrow({
    where: { id: parsed.data.clientId },
    select: { timezone: true, reportIntervalDays: true },
  });
  const def = lastFullPeriod(
    client.reportIntervalDays || DEFAULT_INTERVAL_DAYS,
    client.timezone,
    now,
  );
  const start = parsed.data.periodStart ?? def.start;
  const end = parsed.data.periodEnd ?? def.end;
  if (end < start)
    throw new ValidationError({ periodEnd: ["The end must not be before the start"] });
  if (daysBetween(start, end) > 92)
    throw new ValidationError({ periodEnd: ["A report covers at most 92 days"] });
  if (end > zonedDay(now, client.timezone))
    throw new ValidationError({ periodEnd: ["The period cannot end in the future"] });
  if (start < "2020-01-01")
    throw new ValidationError({ periodStart: ["Choose a more recent start"] });
  const r = await createReportRecord({
    agencyId: ctx.agencyId,
    clientId: parsed.data.clientId,
    start,
    end,
    source: "manual",
    createdById: actor.userId,
  });
  if (r.created)
    await prisma().$transaction((tx) =>
      recordAudit(tx, {
        actorUserId: actor.userId,
        agencyId: ctx.agencyId,
        clientId: parsed.data.clientId,
        action: "report.requested",
        entityType: "report",
        entityId: r.id,
        after: { start, end },
      }),
    );
  return r;
}

export async function retryReport(actor: Actor, reportId: string) {
  const r = await prisma().report.findUnique({
    where: { id: reportId },
    select: { clientId: true, status: true },
  });
  if (!r) throw new NotFoundError("Report not found");
  await requirePermission(actor, r.clientId, "report.generate");
  const done = await prisma().report.updateMany({
    where: { id: reportId, status: "failed" },
    data: { status: "generating", error: null },
  });
  if (done.count === 0) throw new ConflictError("Only a failed report can be generated again");
}

// ---- Generating (worker) ----------------------------------------------------------------------------------------------

export async function nextGeneratingReport(): Promise<string | null> {
  const r = await prisma().report.findFirst({
    where: { status: "generating" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return r?.id ?? null;
}

export type AiDeps = { provider: AiProvider; config: AiRuntimeConfig } | null;

async function aiSummary(
  a: { agencyId: string; clientId: string; start: string; end: string },
  facts: { label: string; value: number }[],
  deps: AiDeps,
): Promise<{ text: string; jobId: string } | null> {
  if (!deps || deps.provider.key === "mock" || facts.length === 0) return null;
  const usage = await getAiUsage(a.clientId, deps.config);
  if (
    usage.requests >= usage.maxRequests ||
    (usage.maxCostMicros > 0n && usage.costMicros >= usage.maxCostMicros)
  )
    return null;
  const brand = await prisma().brandGuideline.findFirst({
    where: { clientId: a.clientId, isActive: true },
    select: { id: true, version: true },
  });
  const job = await prisma().aiJob.create({
    data: {
      agencyId: a.agencyId,
      clientId: a.clientId,
      kind: "report_summary",
      task: "report_summary",
      status: "running",
      provider: deps.config.provider,
      model: deps.config.model,
      promptVersion: promptVersion("report_summary"),
      startedAt: new Date(),
      input: {
        periodStart: a.start,
        periodEnd: a.end,
        includeSyncedFigures: false,
        notes: "Summarise ONLY the supplied figures.",
      },
      inputRefs: {
        brandGuidelineId: brand?.id ?? null,
        brandVersion: brand?.version ?? null,
        sourceIds: [],
        figures: facts,
      } as unknown as Prisma.InputJsonObject,
    },
    select: { id: true },
  });
  await executeAiJob(job.id, deps.provider, deps.config);
  const done = await prisma().aiJob.findUniqueOrThrow({ where: { id: job.id } });
  if (done.status !== "succeeded") {
    // A report never waits for, or later receives, a retried summary: it keeps the fixed-wording one.
    await prisma().aiJob.updateMany({
      where: { id: job.id, status: { not: "succeeded" } },
      data: { status: "failed", finishedAt: new Date() },
    });
    return null;
  }
  const r = (
    done.output as {
      result: { summary: string; highlights: string[]; risks: string[]; nextSteps: string[] };
    }
  ).result;
  return {
    text: [
      r.summary,
      ...r.highlights.map((h) => `• ${h}`),
      ...r.risks.map((h) => `Risk: ${h}`),
    ].join("\n"),
    jobId: job.id,
  };
}

export async function generateReport(
  reportId: string,
  deps: AiDeps = null,
  now = new Date(),
): Promise<void> {
  const report = await prisma().report.findUnique({
    where: { id: reportId },
    include: { client: { select: { name: true, timezone: true } }, template: true },
  });
  if (!report || report.status !== "generating") return;
  const start = ymd(report.periodStart),
    end = ymd(report.periodEnd);
  try {
    const layout = parseLayout(report.template?.layout);
    const metrics = validateAll(
      await collectMetrics(
        { clientIds: [report.clientId], internal: false, includeMock: false, now },
        { from: start, to: end },
      ),
    );
    const facts = factsOf(metrics);
    const ai = layout.useAi
      ? await aiSummary(
          { agencyId: report.agencyId, clientId: report.clientId, start, end },
          facts,
          deps,
        )
      : null;
    const startDate = new Date(`${start}T00:00:00Z`),
      endEx = new Date(Date.parse(`${end}T00:00:00Z`) + 86_400_000);
    const [topCompleted, topIssues] = await Promise.all([
      prisma().task.findMany({
        where: {
          clientId: report.clientId,
          archivedAt: null,
          status: "completed",
          completedAt: { gte: startDate, lt: endEx },
        },
        orderBy: { completedAt: "desc" },
        take: 10,
        select: { title: true },
      }),
      prisma().seoIssue.findMany({
        where: {
          clientId: report.clientId,
          status: { in: ["open", "reopened", "acknowledged", "in_progress"] },
        },
        orderBy: [{ severity: "desc" }, { lastSeenAt: "desc" }],
        take: 8,
        select: { title: true, severity: true },
      }),
    ]);
    const recommendations = recommendationsFrom(metrics);
    const content: Record<SectionKey, Record<string, unknown>> = {
      summary: {
        text: ai?.text ?? deterministicSummary(metrics, report.client.name, start, end),
        aiGenerated: !!ai,
        aiJobId: ai?.jobId ?? null,
        basis: facts,
      },
      seo: { rankings: metrics.rankings, issuesResolved: metrics.work.issuesResolved },
      search_traffic: { search: metrics.search, traffic: metrics.traffic },
      social: { ...metrics.social },
      work: {
        completed: metrics.work.completed,
        created: metrics.work.created,
        completedTasks: topCompleted.map((t) => t.title),
        series: metrics.work.completedSeries,
      },
      issues: {
        open: metrics.work.issuesOpen,
        total: metrics.work.issuesOpenTotal,
        top: topIssues,
        integrations: metrics.integrations
          .filter((i) => i.status !== "active")
          .map((i) => ({ provider: i.provider, status: i.status })),
      },
      recommendations: { items: recommendations },
      data_sources: {
        sources: metrics.freshness.map((f) => ({
          label: f.label,
          dataThrough: f.dataThrough,
          lastSyncedAt: f.lastSyncedAt,
          stale: f.stale,
        })),
        timezone: report.client.timezone,
        generatedAt: now.toISOString(),
        period: { start, end },
        previousPeriod: metrics.previous,
        note: "Figures come from synced Google Analytics and Search Console data, ranking checks and this platform's own records. A missing figure means no data was available; nothing is estimated.",
      },
    };
    const enabled = layout.sections.filter((s) => s.enabled).map((s) => s.key);
    const snapshots: [string, unknown][] = [
      ["search", metrics.search],
      ["traffic", metrics.traffic],
      ["rankings", metrics.rankings],
      ["social", metrics.social],
      ["work", metrics.work],
      ["sources", metrics.freshness],
    ];

    await prisma().$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM reports WHERE id = ${reportId} AND status = 'generating' FOR UPDATE SKIP LOCKED`;
      if (locked.length === 0) return; // another worker has it, or it is no longer waiting
      await tx.reportSection.deleteMany({ where: { reportId } });
      await tx.reportDataSnapshot.deleteMany({ where: { reportId } });
      for (const [key, data] of snapshots)
        await tx.reportDataSnapshot.create({
          data: {
            agencyId: report.agencyId,
            clientId: report.clientId,
            reportId,
            key,
            rangeStart: report.periodStart,
            rangeEnd: report.periodEnd,
            data: JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue,
            dataHash: hashData(data),
          },
        });
      let position = 0;
      for (const key of enabled) {
        const kind =
          key === "summary"
            ? "summary"
            : key === "recommendations" || key === "data_sources"
              ? "text"
              : "kpi";
        await tx.reportSection.create({
          data: {
            agencyId: report.agencyId,
            clientId: report.clientId,
            reportId,
            key,
            position: position++,
            kind,
            title: SECTION_TITLE[key],
            content: JSON.parse(JSON.stringify(content[key])) as Prisma.InputJsonValue,
            aiGenerated: key === "summary" && !!ai,
          },
        });
      }
      await tx.report.update({
        where: { id: reportId },
        data: { status: "ready", generatedAt: now, error: null },
      });
      await recordAudit(tx, {
        actorUserId: null,
        agencyId: report.agencyId,
        clientId: report.clientId,
        action: "report.generated",
        entityType: "report",
        entityId: reportId,
        after: { sections: enabled.length, ai: !!ai },
      });
      const reviewers = await listUsersWithPermission(
        report.agencyId,
        report.clientId,
        "report.approve",
      );
      if (reviewers.length)
        await tx.notification.createMany({
          data: reviewers.map((userId) => ({
            agencyId: report.agencyId,
            clientId: report.clientId,
            userId,
            type: "report.ready",
            title: `Report ready for review: ${report.title}`,
            entityType: "report",
            entityId: reportId,
          })),
        });
    });
  } catch (error) {
    const message =
      error instanceof Error && !(error as { code?: string }).code
        ? error.message.slice(0, 300)
        : "The report could not be generated.";
    await prisma().report.updateMany({
      where: { id: reportId, status: "generating" },
      data: { status: "failed", error: message },
    });
  }
}

// ---- Reading and review ----------------------------------------------------------------------------------------------

async function visibleStatuses(actor: Actor, clientId: string) {
  const ctx = await requirePermission(actor, clientId, "report.view");
  const staff =
    ctx.access.permissions.has("report.generate") || ctx.access.permissions.has("report.approve");
  // People who only read reports (the client) see a report only after it was approved.
  return { ctx, staff, statuses: staff ? undefined : (["approved", "delivered"] as const) };
}

export async function listReportsFor(
  actor: Actor,
  f: { clientId?: string; status?: string; page?: number } = {},
) {
  const map = await getAccessMap(actor);
  const allowed = clientIdsWith(map, "report.view");
  const ids = f.clientId ? allowed.filter((c) => c === f.clientId) : allowed;
  const page = clampPage(f.page);
  if (ids.length === 0) return paged([], 0, page);
  const staffIds = new Set(
    ids.filter(
      (c) =>
        map.get(c)!.permissions.has("report.generate") ||
        map.get(c)!.permissions.has("report.approve"),
    ),
  );
  const where: Prisma.ReportWhereInput = {
    OR: [
      { clientId: { in: [...staffIds] } },
      {
        clientId: { in: ids.filter((c) => !staffIds.has(c)) },
        status: { in: ["approved", "delivered"] },
      },
    ],
    ...(f.status ? { status: f.status as never } : {}),
  };
  const db = forClients(ids);
  const [rows, total] = await Promise.all([
    db.report.findMany({
      where,
      orderBy: [{ periodEnd: "desc" }, { revision: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        clientId: true,
        title: true,
        status: true,
        periodStart: true,
        periodEnd: true,
        revision: true,
        source: true,
        generatedAt: true,
        approvedAt: true,
        error: true,
        client: { select: { name: true } },
        _count: { select: { reportDeliveries: true } },
      },
    }),
    db.report.count({ where }),
  ]);
  return paged(rows, total, page);
}

export async function getReport(actor: Actor, reportId: string) {
  const found = await prisma().report.findUnique({
    where: { id: reportId },
    select: { clientId: true },
  });
  if (!found) throw new NotFoundError("Report not found");
  const v = await visibleStatuses(actor, found.clientId);
  const report = await v.ctx.db.report.findFirst({
    where: { id: reportId, ...(v.statuses ? { status: { in: [...v.statuses] } } : {}) },
    include: {
      client: { select: { name: true, timezone: true } },
      approvedBy: { select: { name: true } },
      createdBy: { select: { name: true } },
      reportSections: { orderBy: { position: "asc" } },
      reportDataSnapshots: { select: { key: true, dataHash: true, capturedAt: true } },
      ...(v.staff
        ? {
            reportDeliveries: {
              orderBy: { createdAt: "asc" },
              include: { reportDeliveryAttempts: { orderBy: { createdAt: "asc" } } },
            },
          }
        : {}),
    },
  });
  if (!report) throw new NotFoundError("Report not found"); // a draft looks the same as a missing report to a client
  const view: ReportView = {
    id: report.id,
    title: report.title,
    status: report.status,
    clientName: report.client.name,
    timezone: report.client.timezone,
    periodStart: ymd(report.periodStart),
    periodEnd: ymd(report.periodEnd),
    generatedAt: report.generatedAt?.toISOString() ?? null,
    revision: report.revision,
    sections: report.reportSections.map((s) => ({
      key: s.key as SectionKey,
      title: s.title,
      content: s.content as Record<string, unknown>,
      aiGenerated: s.aiGenerated,
    })),
  };
  const canApprove =
    v.ctx.access.permissions.has("report.approve") &&
    report.status === "ready" &&
    !(report.source === "manual" && report.createdById === actor.userId);
  return {
    report: {
      id: report.id,
      status: report.status,
      source: report.source,
      error: report.error,
      reviewNote: report.reviewNote,
      approvedBy: report.approvedBy?.name ?? null,
      approvedAt: report.approvedAt,
      createdBy: report.createdBy?.name ?? null,
      snapshots: report.reportDataSnapshots,
    },
    view,
    staff: v.staff,
    deliveries: v.staff
      ? ((
          report as unknown as {
            reportDeliveries: Array<{
              id: string;
              recipient: string;
              status: string;
              attempts: number;
              resendCount: number;
              error: string | null;
              sentAt: Date | null;
              nextAttemptAt: Date | null;
              reportDeliveryAttempts: {
                id: string;
                attemptNo: number;
                status: string;
                error: string | null;
                createdAt: Date;
              }[];
            }>;
          }
        ).reportDeliveries ?? [])
      : [],
    can: {
      approve: canApprove,
      generate: v.ctx.access.permissions.has("report.generate"),
      review: report.status === "ready" && v.ctx.access.permissions.has("report.approve"),
    },
  };
}

/** Approve (or send back) a generated report. Authors of a manual request cannot approve their own report. */
export async function reviewReport(
  actor: Actor,
  reportId: string,
  input: { decision: "approve" | "request_changes"; note?: string },
) {
  const r = await prisma().report.findUnique({
    where: { id: reportId },
    select: {
      clientId: true,
      status: true,
      source: true,
      createdById: true,
      title: true,
      agencyId: true,
    },
  });
  if (!r) throw new NotFoundError("Report not found");
  const ctx = await requirePermission(actor, r.clientId, "report.approve");
  if (r.status !== "ready") throw new ConflictError("Only a report that is ready can be reviewed");
  if (r.source === "manual" && r.createdById === actor.userId)
    throw new ConflictError("You requested this report, so someone else has to review it");
  const note = input.note?.trim().slice(0, 1000) || null;
  if (input.decision === "request_changes" && !note)
    throw new ValidationError({ note: ["Say what needs to change"] });
  await prisma().$transaction(async (tx) => {
    const done = await tx.report.updateMany({
      where: { id: reportId, status: "ready" },
      data:
        input.decision === "approve"
          ? {
              status: "approved",
              approvedById: actor.userId,
              approvedAt: new Date(),
              reviewNote: note,
            }
          : { status: "draft", reviewNote: note },
    });
    if (done.count === 0) throw new ConflictError("This report was already reviewed");
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: r.clientId,
      action: input.decision === "approve" ? "report.approved" : "report.changes_requested",
      entityType: "report",
      entityId: reportId,
    });
    if (r.createdById && input.decision !== "approve")
      await tx.notification.create({
        data: {
          agencyId: ctx.agencyId,
          clientId: r.clientId,
          userId: r.createdById,
          type: "report.changes_requested",
          title: `Changes requested: ${r.title}`,
          body: note,
          entityType: "report",
          entityId: reportId,
        },
      });
  });
  if (input.decision === "approve") await queueScheduledDeliveries(reportId, actor.userId);
}

/** After approval, deliver to the schedule's recipients if the schedule says so. Existing deliveries are never duplicated. */
export async function queueScheduledDeliveries(reportId: string, byUserId: string | null) {
  const report = await prisma().report.findUnique({
    where: { id: reportId },
    select: { agencyId: true, clientId: true, source: true },
  });
  if (!report) return 0;
  const schedule = await prisma().reportSchedule.findUnique({
    where: { clientId: report.clientId },
  });
  if (!schedule?.deliverOnApproval || schedule.recipients.length === 0) return 0;
  return addDeliveries(report.agencyId, report.clientId, reportId, schedule.recipients, byUserId);
}

export const normalizeEmail = (e: string) => e.trim().toLowerCase();
const emailSchema = z.email().max(320);

async function addDeliveries(
  agencyId: string,
  clientId: string,
  reportId: string,
  recipients: string[],
  byUserId: string | null,
) {
  const list = [...new Set(recipients.map(normalizeEmail))];
  let added = 0;
  for (const recipient of list) {
    try {
      await prisma().$transaction(async (tx) => {
        await tx.reportDelivery.create({
          data: { agencyId, clientId, reportId, channel: "email", recipient, status: "pending" },
        });
        await recordAudit(tx, {
          actorUserId: byUserId,
          agencyId,
          clientId,
          action: "report.delivery_queued",
          entityType: "report",
          entityId: reportId,
          after: { recipient },
        });
      });
      added++;
    } catch (error) {
      if (!isUnique(error)) throw error; // already queued or sent to this address: never twice
    }
  }
  return added;
}

/** Send an approved report to more recipients. Addresses that already have a delivery are skipped (use resend for those). */
export async function sendReport(actor: Actor, reportId: string, recipients: string[]) {
  const r = await prisma().report.findUnique({
    where: { id: reportId },
    select: { clientId: true, agencyId: true, status: true },
  });
  if (!r) throw new NotFoundError("Report not found");
  await requirePermission(actor, r.clientId, "report.generate");
  if (!["approved", "delivered"].includes(r.status))
    throw new ConflictError("A report has to be approved before it is sent");
  const clean: string[] = [];
  for (const raw of recipients) {
    const e = normalizeEmail(raw);
    if (!emailSchema.safeParse(e).success)
      throw new ValidationError({ recipients: [`"${raw}" is not an email address`] });
    clean.push(e);
  }
  if (clean.length === 0)
    throw new ValidationError({ recipients: ["Enter at least one email address"] });
  if (clean.length > 20) throw new ValidationError({ recipients: ["At most 20 recipients"] });
  const added = await addDeliveries(r.agencyId, r.clientId, reportId, clean, actor.userId);
  return { added, skipped: new Set(clean).size - added };
}

/** Manual resend: the same delivery row goes back to the queue, so history stays in one place and the count shows it. */
export async function resendDelivery(
  actor: Actor,
  deliveryId: string,
  opts: { confirmNotReceived?: boolean } = {},
) {
  const d = await prisma().reportDelivery.findUnique({
    where: { id: deliveryId },
    select: { clientId: true, agencyId: true, status: true, reportId: true, recipient: true },
  });
  if (!d) throw new NotFoundError("Delivery not found");
  await requirePermission(actor, d.clientId, "report.generate");
  if (["pending", "sending"].includes(d.status))
    throw new ConflictError("This delivery is already queued");
  if (d.status === "needs_review" && !opts.confirmNotReceived)
    throw new ConflictError(
      "We could not confirm whether this was sent. Check with the recipient, then confirm to send it again.",
    );
  await prisma().$transaction(async (tx) => {
    await tx.reportDelivery.update({
      where: { id: deliveryId },
      data: {
        status: "pending",
        error: null,
        nextAttemptAt: null,
        requestSentAt: null,
        startedAt: null,
        resendCount: { increment: 1 },
      },
    });
    await tx.reportDeliveryAttempt.create({
      data: {
        agencyId: d.agencyId,
        clientId: d.clientId,
        deliveryId,
        attemptNo: 0,
        status: "pending",
        triggeredById: actor.userId,
        error: "Resend requested",
      },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: d.agencyId,
      clientId: d.clientId,
      action: "report.delivery_resent",
      entityType: "report",
      entityId: d.reportId,
      after: { recipient: d.recipient },
    });
  });
}

void addDays;
