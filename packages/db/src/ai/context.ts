import { ValidationError } from "../errors";
import { getUnscopedPrisma } from "../unsafe";
import type { AiTask, PromptContext } from "./templates";

const prisma = () => getUnscopedPrisma();
const MAX_SOURCES = 20;
const MAX_CONTEXT_CHARS = 14_000;
const trim = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export type AiScope = { agencyId: string; clientId: string; projectId?: string | null };

/** The ids the model may see, recorded on the job so a result can be traced to its inputs. */
export type InputRefs = {
  brandGuidelineId: string | null;
  brandVersion: number | null;
  sourceIds: string[];
  sourceContentItemId?: string;
  includedSeoIssueIds?: string[];
  figures?: { label: string; value: number }[];
};

/**
 * Decide, at request time, what the model will be allowed to see. Every lookup is scoped by client, so an id
 * from another client (typed by hand, or tampered with in a form) is refused rather than read.
 */
export async function resolveRefs(
  scope: AiScope,
  task: AiTask,
  input: Record<string, unknown>,
  requestedSourceIds?: string[],
): Promise<InputRefs> {
  const brand = await prisma().brandGuideline.findFirst({
    where: { clientId: scope.clientId, isActive: true },
    select: { id: true, version: true },
  });
  const sourceWhere = {
    clientId: scope.clientId,
    archivedAt: null,
    OR: [{ projectId: null }, ...(scope.projectId ? [{ projectId: scope.projectId }] : [])],
  };
  let sourceIds: string[];
  if (requestedSourceIds && requestedSourceIds.length > 0) {
    const found = await prisma().aiApprovedSource.findMany({
      where: { ...sourceWhere, id: { in: requestedSourceIds } },
      select: { id: true },
    });
    if (found.length !== new Set(requestedSourceIds).size)
      throw new ValidationError({ sourceIds: ["Choose only approved sources of this client"] });
    sourceIds = found.map((f) => f.id);
  } else {
    sourceIds = (
      await prisma().aiApprovedSource.findMany({
        where: sourceWhere,
        orderBy: { approvedAt: "desc" },
        take: MAX_SOURCES,
        select: { id: true },
      })
    ).map((f) => f.id);
  }
  const refs: InputRefs = {
    brandGuidelineId: brand?.id ?? null,
    brandVersion: brand?.version ?? null,
    sourceIds,
  };

  if (task === "repurpose") {
    const id = String(input.sourceContentItemId);
    const item = await prisma().contentItem.findFirst({
      where: { id, clientId: scope.clientId, archivedAt: null },
      select: { id: true, currentVersionId: true },
    });
    if (!item || !item.currentVersionId)
      throw new ValidationError({
        sourceContentItemId: ["Choose content of this client that has a version"],
      });
    refs.sourceContentItemId = item.id;
  }
  if (task === "seo_recommendations" && input.includeOpenSeoIssues) {
    const issues = await prisma().seoIssue.findMany({
      where: { clientId: scope.clientId, status: { in: ["open", "reopened"] } },
      orderBy: [{ severity: "desc" }, { lastSeenAt: "desc" }],
      take: 15,
      select: { id: true },
    });
    refs.includedSeoIssueIds = issues.map((i) => i.id);
  }
  if (task === "report_summary" && input.includeSyncedFigures) {
    refs.figures = await syncedFigures(
      scope.clientId,
      String(input.periodStart),
      String(input.periodEnd),
    );
  }
  return refs;
}

/** Top-line figures from synced (non-mock) analytics. They are labelled as synced readings, not verified facts. */
async function syncedFigures(clientId: string, from: string, to: string) {
  const rows = await prisma().$queryRaw<{ key: string; total: number }[]>`
    WITH latest AS (
      SELECT DISTINCT ON (s.analytics_source_id, s.metric_definition_id, s.period_start, s.dimension_key)
        d.key, s.value::float8 AS value
      FROM metric_snapshots s
      JOIN metric_definitions d ON d.id = s.metric_definition_id
      JOIN analytics_sources a ON a.id = s.analytics_source_id
      WHERE s.client_id = ${clientId} AND s.period_start BETWEEN ${from}::date AND ${to}::date
        AND d.key IN ('gsc.clicks', 'gsc.impressions', 'ga4.sessions') AND s.dimension_key = ''
        AND COALESCE(a.metadata->>'mock', 'false') <> 'true'
      ORDER BY s.analytics_source_id, s.metric_definition_id, s.period_start, s.dimension_key, s.captured_at DESC)
    SELECT key, sum(value)::float8 AS total FROM latest GROUP BY key`;
  const label: Record<string, string> = {
    "gsc.clicks": "Search Console clicks",
    "gsc.impressions": "Search Console impressions",
    "ga4.sessions": "Analytics sessions",
  };
  return rows.map((r) => ({ label: label[r.key]!, value: Math.round(r.total) }));
}

/** Load the material named by the job's refs, scoped to the job's client again (the job row could be old). */
export async function loadPromptContext(
  scope: AiScope,
  refs: InputRefs,
  input: Record<string, unknown>,
): Promise<PromptContext> {
  const client = await prisma().client.findFirstOrThrow({
    where: { id: scope.clientId, agencyId: scope.agencyId },
    select: { name: true },
  });
  const brand = refs.brandGuidelineId
    ? await prisma().brandGuideline.findFirst({
        where: { id: refs.brandGuidelineId, clientId: scope.clientId },
      })
    : null;
  const sourceRows = refs.sourceIds.length
    ? await prisma().aiApprovedSource.findMany({
        where: { id: { in: refs.sourceIds }, clientId: scope.clientId, archivedAt: null },
      })
    : [];
  let budget = MAX_CONTEXT_CHARS;
  const sources: PromptContext["sources"] = [];
  for (const s of sourceRows) {
    if (budget <= 0) break;
    const body = trim(s.body, Math.min(budget, 4000));
    budget -= body.length;
    sources.push({ id: s.id, title: s.title, body });
  }
  const extra: PromptContext["extra"] = [];
  if (refs.sourceContentItemId) {
    const item = await prisma().contentItem.findFirst({
      where: { id: refs.sourceContentItemId, clientId: scope.clientId },
      select: {
        title: true,
        channel: true,
        currentVersion: { select: { body: true, title: true } },
      },
    });
    if (item?.currentVersion)
      extra.push({
        label: `source content (${item.channel})`,
        text: `${item.currentVersion.title ?? item.title}\n\n${trim(item.currentVersion.body, 8000)}`,
      });
  }
  if (refs.includedSeoIssueIds?.length) {
    const issues = await prisma().seoIssue.findMany({
      where: { id: { in: refs.includedSeoIssueIds }, clientId: scope.clientId },
      select: { title: true, severity: true, status: true },
    });
    extra.push({
      label: "open SEO issues (synced from the audit tool, not verified by us)",
      text: issues.map((i) => `- [${i.severity}] ${i.title}`).join("\n") || "none",
    });
  }
  if (refs.figures) {
    extra.push({
      label: `synced figures ${input.periodStart}..${input.periodEnd} (readings from connected tools, not verified)`,
      text: refs.figures.length
        ? refs.figures.map((f) => `${f.label}: ${f.value}`).join("\n")
        : "No synced figures for this period.",
    });
  }
  return {
    clientName: client.name,
    brand: brand
      ? {
          name: brand.name,
          version: brand.version,
          tone: brand.toneOfVoice,
          audience: brand.audience,
          style: brand.styleNotes,
          dos: brand.dos,
          donts: brand.donts,
          bannedTerms: brand.bannedTerms,
        }
      : null,
    sources,
    extra,
  };
}
