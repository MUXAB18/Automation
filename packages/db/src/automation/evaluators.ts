import { createHash } from "node:crypto";
import { getUnscopedPrisma } from "../unsafe";
import type { ConfigOf, RuleKind } from "./config";

/**
 * One evaluator per rule type. Each reads REAL synchronised data for one client (never another's),
 * first checks the data is present and fresh, then returns the conditions that hold. Evaluators only
 * read: creating issues, tasks and notifications is the engine's job.
 */

const prisma = () => getUnscopedPrisma();
const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => ymd(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY));
const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export type Finding = {
  /** Stable identity: the same condition always has the same key, so it is never recorded twice. */
  dedupeKey: string;
  title: string;
  severity: Severity;
  entityType: string;
  entityId: string;
  projectId?: string | null;
  details: Record<string, unknown>;
  /** Values available to the task template as {{name}}. */
  vars: Record<string, string | number | null>;
  /** An existing site-audit issue this finding is about. */
  seoIssueId?: string;
  /** The person who owns the thing (for "entity owner" assignment). */
  ownerUserId?: string | null;
  /** An open task that already covers this (so none is created). */
  existingTaskId?: string | null;
  /** The finding has crossed its escalation point. */
  escalate?: boolean;
};

export type Outcome = {
  /** ok = the data is there and fresh. stale / no_data = the rule did not run (and says why). */
  status: "ok" | "stale" | "no_data";
  reason?: string;
  findings: Finding[];
  checked: number;
};

export type EvalContext = {
  agencyId: string;
  clientId: string;
  projectId: string | null;
  timezone: string;
  now: Date;
  severity: Severity;
  config: unknown;
};

const notOk = (status: "stale" | "no_data", reason: string): Outcome => ({
  status,
  reason,
  findings: [],
  checked: 0,
});
const cfg = <K extends RuleKind>(ctx: EvalContext) => ctx.config as ConfigOf<K>;

// ---- 1. Important keyword ranking drop -------------------------------------------------------------------

async function keywordRankDrop(ctx: EvalContext): Promise<Outcome> {
  const c = cfg<"keyword_rank_drop">(ctx);
  const keywords = await prisma().keyword.findMany({
    where: {
      clientId: ctx.clientId,
      isActive: true,
      tags: { has: c.importantTag },
      ...(ctx.projectId ? { seoProject: { projectId: ctx.projectId } } : {}),
    },
    select: { id: true, term: true, seoProject: { select: { projectId: true } } },
  });
  if (keywords.length === 0) return notOk("no_data", `No keywords are tagged "${c.importantTag}".`);
  const today = ymd(ctx.now);
  const snaps = await prisma().keywordRankSnapshot.findMany({
    where: {
      clientId: ctx.clientId,
      keywordId: { in: keywords.map((k) => k.id) },
      checkedOn: { gte: new Date(ctx.now.getTime() - (c.compareDays + 21) * DAY) },
    },
    orderBy: [{ checkedOn: "desc" }, { capturedAt: "desc" }],
    select: { keywordId: true, checkedOn: true, position: true, url: true },
  });
  const byKeyword = new Map<string, Map<string, { position: number | null; url: string | null }>>();
  for (const s of snaps) {
    const days = byKeyword.get(s.keywordId) ?? new Map();
    const day = ymd(s.checkedOn);
    if (!days.has(day))
      days.set(day, { position: s.position === null ? null : s.position.toNumber(), url: s.url }); // newest capture wins
    byKeyword.set(s.keywordId, days);
  }
  const findings: Finding[] = [];
  let fresh = 0;
  let checked = 0;
  for (const k of keywords) {
    const days = byKeyword.get(k.id);
    if (!days || days.size === 0) continue;
    const latestDay = [...days.keys()].sort().at(-1)!;
    if (latestDay < addDays(today, -c.maxStaleDays)) continue; // this keyword's data is too old to judge
    fresh++;
    const baselineDay = [...days.keys()]
      .sort()
      .filter((d) => d <= addDays(latestDay, -c.compareDays))
      .at(-1);
    if (!baselineDay) continue; // not enough history yet
    checked++;
    const latest = days.get(latestDay)!;
    const base = days.get(baselineDay)!;
    const lost = c.includeLostRankings && base.position !== null && latest.position === null;
    const drop =
      latest.position !== null && base.position !== null ? latest.position - base.position : null;
    if (!lost && !(drop !== null && drop >= c.positionDrop)) continue;
    findings.push({
      dedupeKey: `kw-drop:${k.id}`,
      severity: ctx.severity,
      entityType: "keyword",
      entityId: k.id,
      projectId: k.seoProject.projectId,
      title: lost ? `"${k.term}" stopped ranking` : `"${k.term}" dropped ${drop} positions`,
      details: {
        keyword: k.term,
        from: base.position,
        to: latest.position,
        drop,
        baselineDay,
        latestDay,
        url: latest.url ?? base.url,
      },
      vars: {
        keyword: k.term,
        from: base.position,
        to: latest.position ?? "not ranking",
        drop: drop ?? "",
        baselineDay,
        latestDay,
        url: latest.url ?? base.url ?? "",
      },
    });
  }
  if (fresh === 0)
    return notOk(
      "stale",
      `No important keyword has a ranking reading from the last ${c.maxStaleDays} days.`,
    );
  return { status: "ok", findings, checked };
}

// ---- 2. Critical site audit issue ------------------------------------------------------------------------

const AT_LEAST = {
  low: ["low", "medium", "high", "critical"],
  medium: ["medium", "high", "critical"],
  high: ["high", "critical"],
  critical: ["critical"],
} as const;

async function criticalAuditIssue(ctx: EvalContext): Promise<Outcome> {
  const c = cfg<"critical_audit_issue">(ctx);
  const projects = await prisma().seoProject.findMany({
    where: { clientId: ctx.clientId, ...(ctx.projectId ? { projectId: ctx.projectId } : {}) },
    select: { id: true, projectId: true },
  });
  if (projects.length === 0) return notOk("no_data", "There is no SEO project to audit.");
  const ids = projects.map((p) => p.id);
  const audit = await prisma().siteAudit.findFirst({
    where: { clientId: ctx.clientId, seoProjectId: { in: ids }, status: "completed" },
    orderBy: [{ finishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: { finishedAt: true, createdAt: true },
  });
  if (!audit) return notOk("no_data", "No completed site audit has been imported.");
  const when = audit.finishedAt ?? audit.createdAt;
  if (when.getTime() < ctx.now.getTime() - c.maxAuditAgeDays * DAY)
    return notOk("stale", `The latest site audit is older than ${c.maxAuditAgeDays} days.`);
  const issues = await prisma().seoIssue.findMany({
    where: {
      clientId: ctx.clientId,
      seoProjectId: { in: ids },
      status: { in: ["open", "reopened"] },
      severity: { in: [...AT_LEAST[c.minSeverity]] },
    },
    select: {
      id: true,
      title: true,
      severity: true,
      ruleKey: true,
      details: true,
      seoProjectId: true,
      task: { select: { id: true, status: true } },
    },
  });
  const projectOf = new Map(projects.map((p) => [p.id, p.projectId]));
  const findings = issues.map<Finding>((i) => {
    const d = (i.details ?? {}) as {
      section?: string | null;
      pagesAffected?: number | null;
      sampleUrls?: string[];
    };
    const open = i.task && i.task.status !== "completed" && i.task.status !== "cancelled";
    return {
      dedupeKey: `issue:${i.id}`,
      severity: i.severity as Severity,
      entityType: "seo_issue",
      entityId: i.id,
      projectId: projectOf.get(i.seoProjectId) ?? null,
      title: i.title,
      seoIssueId: i.id,
      existingTaskId: open ? i.task!.id : null,
      details: {
        ruleKey: i.ruleKey,
        section: d.section ?? null,
        pagesAffected: d.pagesAffected ?? null,
        sampleUrls: (d.sampleUrls ?? []).slice(0, 5),
      },
      vars: {
        issue: i.title,
        section: d.section ?? "Site audit",
        pages: d.pagesAffected ?? "?",
        examples: (d.sampleUrls ?? []).slice(0, 5).join("\n"),
        severity: i.severity,
      },
    };
  });
  return { status: "ok", findings, checked: issues.length };
}

// ---- Shared: Search Console / Analytics sources ----------------------------------------------------------------

async function sourcesFor(ctx: EvalContext, kind: "ga4" | "search_console") {
  let websiteIds: string[] | null = null;
  if (ctx.projectId) {
    const seo = await prisma().seoProject.findMany({
      where: { clientId: ctx.clientId, projectId: ctx.projectId },
      select: { websiteId: true },
    });
    websiteIds = seo.map((s) => s.websiteId);
  }
  return prisma().analyticsSource.findMany({
    where: {
      clientId: ctx.clientId,
      kind,
      isActive: true,
      ...(websiteIds ? { websiteId: { in: websiteIds } } : {}),
    },
    select: { id: true, externalId: true, displayName: true, dataThrough: true, metadata: true },
  });
}
const isMockSource = (m: unknown) => (m as { mock?: boolean } | null)?.mock === true;

// ---- 3. Important page needs optimization -------------------------------------------------------------------

async function pageNeedsOptimization(ctx: EvalContext): Promise<Outcome> {
  const c = cfg<"page_needs_optimization">(ctx);
  const sources = (await sourcesFor(ctx, "search_console")).filter(
    (s) => !isMockSource(s.metadata),
  );
  if (sources.length === 0)
    return notOk("no_data", "No Search Console property is connected and selected.");
  const cutoff = addDays(ymd(ctx.now), -c.maxStaleDays);
  const usable = sources.filter((s) => s.dataThrough && ymd(s.dataThrough) >= cutoff);
  if (usable.length === 0)
    return notOk("stale", `Search Console data is older than ${c.maxStaleDays} days.`);
  const findings: Finding[] = [];
  for (const s of usable) {
    const to = ymd(s.dataThrough!);
    const from = addDays(to, -(c.windowDays - 1));
    const rows = await prisma().$queryRaw<
      { dimension_key: string; clicks: number; impressions: number; position: number }[]
    >`
      WITH latest AS (
        SELECT DISTINCT ON (s.metric_definition_id, s.period_start, s.dimension_key) d.key, s.period_start, s.dimension_key, s.value::float8 AS value
        FROM metric_snapshots s JOIN metric_definitions d ON d.id = s.metric_definition_id
        WHERE s.client_id = ${ctx.clientId} AND s.analytics_source_id = ${s.id} AND s.dimension_key LIKE 'page=%'
          AND d.key IN ('gsc.clicks', 'gsc.impressions', 'gsc.position') AND s.period_start BETWEEN ${from}::date AND ${to}::date
        ORDER BY s.metric_definition_id, s.period_start, s.dimension_key, s.captured_at DESC),
      pivot AS (SELECT period_start, dimension_key, max(value) FILTER (WHERE key = 'gsc.clicks') AS clicks, max(value) FILTER (WHERE key = 'gsc.impressions') AS impressions, max(value) FILTER (WHERE key = 'gsc.position') AS position FROM latest GROUP BY period_start, dimension_key),
      agg AS (SELECT dimension_key, sum(clicks) AS clicks, sum(impressions) AS impressions, sum(position * impressions) / nullif(sum(impressions), 0) AS position FROM pivot GROUP BY dimension_key)
      SELECT dimension_key, clicks::float8 AS clicks, impressions::float8 AS impressions, position::float8 AS position FROM agg
      WHERE impressions >= ${c.minImpressions} AND position BETWEEN ${c.minPosition} AND ${c.maxPosition} AND clicks / impressions <= ${c.maxCtr}
      ORDER BY impressions DESC LIMIT ${c.maxFindings}`;
    for (const r of rows) {
      const url = r.dimension_key.slice("page=".length);
      const ctr = r.impressions > 0 ? r.clicks / r.impressions : 0;
      findings.push({
        dedupeKey: `page-opt:${s.id}:${hash(url)}`,
        severity: ctx.severity,
        entityType: "page",
        entityId: url.slice(0, 400),
        projectId: ctx.projectId,
        title: `Page needs optimization: ${url}`,
        details: {
          url,
          impressions: r.impressions,
          clicks: r.clicks,
          position: Math.round(r.position * 10) / 10,
          ctr,
          windowDays: c.windowDays,
          source: s.displayName ?? s.externalId,
          through: to,
        },
        vars: {
          page: url,
          url,
          impressions: Math.round(r.impressions),
          clicks: Math.round(r.clicks),
          position: (Math.round(r.position * 10) / 10).toString(),
          ctr: `${(ctr * 100).toFixed(1)}%`,
          windowDays: c.windowDays,
        },
      });
    }
  }
  return { status: "ok", findings, checked: usable.length };
}

// ---- 4. Organic search traffic drop --------------------------------------------------------------------------------

async function windowSum(
  clientId: string,
  sourceId: string,
  key: string,
  dimensionKey: string,
  from: string,
  to: string,
) {
  const rows = await prisma().$queryRaw<{ total: number | null; days: number }[]>`
    WITH latest AS (
      SELECT DISTINCT ON (s.period_start) s.period_start, s.value::float8 AS value
      FROM metric_snapshots s JOIN metric_definitions d ON d.id = s.metric_definition_id
      WHERE s.client_id = ${clientId} AND s.analytics_source_id = ${sourceId} AND d.key = ${key} AND s.dimension_key = ${dimensionKey}
        AND s.period_start BETWEEN ${from}::date AND ${to}::date
      ORDER BY s.period_start, s.captured_at DESC)
    SELECT sum(value)::float8 AS total, count(*)::int AS days FROM latest`;
  return { total: rows[0]?.total ?? 0, days: rows[0]?.days ?? 0 };
}

async function organicTrafficDrop(ctx: EvalContext): Promise<Outcome> {
  const c = cfg<"organic_traffic_drop">(ctx);
  const ga = c.metric === "ga4_organic";
  const all = await sourcesFor(ctx, ga ? "ga4" : "search_console");
  const sources = all.filter((s) => !isMockSource(s.metadata));
  if (sources.length === 0)
    return notOk(
      "no_data",
      all.length > 0
        ? "Only development mock data is connected. Rules ignore made-up data."
        : `No ${ga ? "Google Analytics" : "Search Console"} property is connected and selected.`,
    );
  const cutoff = addDays(ymd(ctx.now), -c.maxStaleDays);
  const usable = sources.filter((s) => s.dataThrough && ymd(s.dataThrough) >= cutoff);
  if (usable.length === 0)
    return notOk(
      "stale",
      `${ga ? "Google Analytics" : "Search Console"} data is older than ${c.maxStaleDays} days.`,
    );
  const findings: Finding[] = [];
  let checked = 0;
  let insufficient = 0;
  for (const s of usable) {
    const end = ymd(s.dataThrough!);
    const curFrom = addDays(end, -(c.windowDays - 1));
    const prevTo = addDays(curFrom, -1);
    const prevFrom = addDays(prevTo, -(c.windowDays - 1));
    const key = ga ? "ga4.sessions" : "gsc.clicks";
    const dim = ga ? "channel=Organic Search" : "";
    const [cur, prev] = await Promise.all([
      windowSum(ctx.clientId, s.id, key, dim, curFrom, end),
      windowSum(ctx.clientId, s.id, key, dim, prevFrom, prevTo),
    ]);
    const need = Math.ceil(c.windowDays * 0.7);
    if (cur.days < need || prev.days < need) {
      insufficient++;
      continue;
    } // not enough history to compare fairly
    checked++;
    if (prev.total < c.minBaseline) continue; // too little traffic for a percentage to mean anything
    const dropPercent = ((prev.total - cur.total) / prev.total) * 100;
    if (dropPercent < c.dropPercent) continue;
    const name = s.displayName ?? s.externalId;
    findings.push({
      dedupeKey: `traffic-drop:${s.id}:${c.metric}`,
      severity: ctx.severity,
      entityType: "analytics_source",
      entityId: s.id,
      projectId: ctx.projectId,
      title: `Organic traffic down ${Math.round(dropPercent)}% (${name})`,
      details: {
        metric: c.metric,
        previous: prev.total,
        current: cur.total,
        dropPercent: Math.round(dropPercent * 10) / 10,
        currentPeriod: `${curFrom} to ${end}`,
        previousPeriod: `${prevFrom} to ${prevTo}`,
        source: name,
      },
      vars: {
        dropPercent: Math.round(dropPercent),
        previous: Math.round(prev.total),
        current: Math.round(cur.total),
        currentPeriod: `${curFrom} to ${end}`,
        previousPeriod: `${prevFrom} to ${prevTo}`,
        source: name,
        metricLabel: ga ? "Organic search sessions" : "Search clicks",
      },
    });
  }
  if (checked === 0 && insufficient > 0)
    return notOk(
      "no_data",
      `Not enough history yet: ${c.windowDays * 2} days of readings are needed to compare periods.`,
    );
  return { status: "ok", findings, checked };
}

// ---- 5. Content deadline approaching ----------------------------------------------------------------------------------

async function contentDeadline(ctx: EvalContext): Promise<Outcome> {
  const c = cfg<"content_deadline_approaching">(ctx);
  const from = c.includeMissed ? new Date(ctx.now.getTime() - 7 * DAY) : ctx.now;
  const items = await prisma().contentItem.findMany({
    where: {
      clientId: ctx.clientId,
      archivedAt: null,
      status: { in: ["draft", "in_review", "changes_requested"] },
      scheduledFor: { gte: from, lte: new Date(ctx.now.getTime() + c.hoursAhead * 3_600_000) },
      ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
    },
    select: {
      id: true,
      title: true,
      channel: true,
      status: true,
      scheduledFor: true,
      assignedToId: true,
      projectId: true,
      tasks: {
        where: { status: { notIn: ["completed", "cancelled"] }, archivedAt: null },
        select: { id: true },
        take: 1,
      },
    },
  });
  const findings = items.map<Finding>((i) => {
    const at = i.scheduledFor!;
    const late = at < ctx.now;
    const hours = Math.round((at.getTime() - ctx.now.getTime()) / 3_600_000);
    return {
      dedupeKey: `content:${i.id}:${ymd(at)}`,
      severity: late && ctx.severity !== "critical" ? "high" : ctx.severity,
      entityType: "content_item",
      entityId: i.id,
      projectId: i.projectId,
      title: late ? `Content overdue: ${i.title}` : `Content due in ${hours}h: ${i.title}`,
      ownerUserId: i.assignedToId,
      existingTaskId: i.tasks[0]?.id ?? null,
      details: { status: i.status, channel: i.channel, scheduledFor: at.toISOString(), late },
      vars: {
        content: i.title,
        channel: i.channel,
        status: i.status.replace(/_/g, " "),
        scheduledFor: ymd(at),
        when: late ? "now (overdue)" : `in ${hours} hours`,
      },
    };
  });
  return { status: "ok", findings, checked: items.length };
}

// ---- 6. Task overdue ---------------------------------------------------------------------------------------------------

async function taskOverdue(ctx: EvalContext): Promise<Outcome> {
  const c = cfg<"task_overdue">(ctx);
  const cutoff = new Date(ctx.now.getTime() - c.graceHours * 3_600_000);
  const tasks = await prisma().task.findMany({
    where: {
      clientId: ctx.clientId,
      archivedAt: null,
      status: { notIn: ["completed", "cancelled", "approved"] },
      dueAt: { lt: cutoff },
      ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
    },
    select: { id: true, title: true, dueAt: true, assigneeId: true, projectId: true, status: true },
    take: 500,
  });
  const findings = tasks.map<Finding>((t) => {
    const days = Math.floor((ctx.now.getTime() - t.dueAt!.getTime()) / DAY);
    return {
      dedupeKey: `overdue:${t.id}`,
      severity: ctx.severity,
      entityType: "task",
      entityId: t.id,
      projectId: t.projectId,
      title: `Task overdue: ${t.title}`,
      ownerUserId: t.assigneeId,
      existingTaskId: t.id,
      escalate: days >= c.escalateAfterDays,
      details: { dueAt: t.dueAt!.toISOString(), daysOverdue: days, status: t.status },
      vars: { task: t.title, daysOverdue: days, dueAt: ymd(t.dueAt!) },
    };
  });
  return { status: "ok", findings, checked: tasks.length };
}

// ---- 7. Integration repeatedly failing ---------------------------------------------------------------------------------

async function integrationFailing(ctx: EvalContext): Promise<Outcome> {
  const c = cfg<"integration_failing">(ctx);
  const accounts = (
    await prisma().integrationAccount.findMany({
      where: { clientId: ctx.clientId, status: { not: "disconnected" } },
      select: {
        id: true,
        status: true,
        displayName: true,
        metadata: true,
        integration: { select: { name: true } },
      },
    })
  ).filter((a) => !isMockSource(a.metadata));
  const findings: Finding[] = [];
  for (const a of accounts) {
    const runs = await prisma().syncRun.findMany({
      where: { integrationAccountId: a.id, status: { in: ["succeeded", "partial", "failed"] } },
      orderBy: { createdAt: "desc" },
      take: c.consecutiveFailures,
      select: { status: true, syncErrors: { select: { code: true, message: true }, take: 3 } },
    });
    const failing =
      runs.length === c.consecutiveFailures && runs.every((r) => r.status === "failed");
    const needsReauth = c.includeNeedsReauth && a.status === "needs_reauth";
    if (!failing && !needsReauth) continue;
    const name = a.displayName ?? a.integration.name;
    const errors = [...new Set(runs.flatMap((r) => r.syncErrors.map((e) => e.message)))].slice(
      0,
      3,
    );
    findings.push({
      dedupeKey: `integration:${a.id}`,
      severity: ctx.severity,
      entityType: "integration_account",
      entityId: a.id,
      projectId: null,
      title:
        needsReauth && !failing
          ? `${name} needs to be reconnected`
          : `${name} failed its last ${c.consecutiveFailures} syncs`,
      details: { status: a.status, failures: failing ? c.consecutiveFailures : 0, errors },
      vars: {
        integration: name,
        failures: c.consecutiveFailures,
        errors: errors.join("; ") || "no details recorded",
      },
    });
  }
  return { status: "ok", findings, checked: accounts.length };
}

export const EVALUATORS: Record<RuleKind, (ctx: EvalContext) => Promise<Outcome>> = {
  keyword_rank_drop: keywordRankDrop,
  critical_audit_issue: criticalAuditIssue,
  page_needs_optimization: pageNeedsOptimization,
  organic_traffic_drop: organicTrafficDrop,
  content_deadline_approaching: contentDeadline,
  task_overdue: taskOverdue,
  integration_failing: integrationFailing,
};
