import { forClients, getAccessMap, clientIdsWith, type Actor } from "../access";
import type { Prisma } from "../generated/client";
import type { Permission } from "../permissions";
import { getUnscopedPrisma } from "../unsafe";

/**
 * Read models for the dashboard sections (Projects, Tasks, SEO, Content, ...). Every function:
 *  1. works out which clients the actor may use for THIS section's permission (getAccessMap),
 *  2. intersects that with the client/project they selected (an id they cannot use yields an empty result),
 *  3. runs through the scoped Prisma client, and
 *  4. for users whose only role is Client, limits rows to the projects they were added to.
 * Selecting someone else's client or project id therefore returns nothing, never their data.
 */

export const PAGE_SIZE = 20;

export type Selection = { clientId?: string; projectId?: string };
export type Page = { page?: number };

export type Paged<T> = { rows: T[]; total: number; page: number; pageCount: number };

const clampPage = (page: number | undefined) => Math.max(1, Math.floor(page ?? 1) || 1);
const paged = <T>(rows: T[], total: number, page: number): Paged<T> => ({
  rows,
  total,
  page,
  pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
});

type Resolved = {
  clientIds: string[];
  /** Per-client project allow-list for client-only users; clients absent here are unrestricted. */
  projectLimits: Map<string, string[]>;
  projectId?: string;
  restrictedClients: string[];
};

async function resolve(
  actor: Actor,
  permission: Permission,
  selection: Selection = {},
): Promise<Resolved> {
  const map = await getAccessMap(actor);
  let clientIds = clientIdsWith(map, permission);
  if (selection.clientId) clientIds = clientIds.filter((id) => id === selection.clientId);

  // Client-role-only users see only the projects they belong to.
  const restricted = clientIds.filter((id) => {
    const e = map.get(id)!;
    return !e.roles.has("platform_admin") && [...e.roles].every((r) => r === "client");
  });
  const projectLimits = new Map<string, string[]>();
  if (restricted.length > 0) {
    const memberships = await getUnscopedPrisma().projectMembership.findMany({
      where: { userId: actor.userId, clientId: { in: restricted } },
      select: { clientId: true, projectId: true },
    });
    for (const id of restricted) projectLimits.set(id, []);
    for (const m of memberships) projectLimits.get(m.clientId)!.push(m.projectId);
  }

  let projectId = selection.projectId;
  if (projectId) {
    const project = await getUnscopedPrisma().project.findUnique({
      where: { id: projectId },
      select: { clientId: true },
    });
    const allowed =
      project &&
      clientIds.includes(project.clientId) &&
      (!projectLimits.has(project.clientId) ||
        projectLimits.get(project.clientId)!.includes(projectId));
    if (!allowed) {
      clientIds = [];
      projectId = undefined;
    } else {
      clientIds = [project.clientId];
    }
  }
  return { clientIds, projectLimits, projectId, restrictedClients: restricted };
}

/** `where` fragment limiting rows to allowed clients (and, for client-only users, allowed projects). */
function tenantWhere(r: Resolved, projectField: "projectId" | "id" | null) {
  if (r.clientIds.length === 0) return { clientId: { in: [] as string[] } };
  const unrestricted = r.clientIds.filter((id) => !r.projectLimits.has(id));
  const or: Record<string, unknown>[] = [];
  if (unrestricted.length > 0) or.push({ clientId: { in: unrestricted } });
  for (const [clientId, projects] of r.projectLimits) {
    if (!r.clientIds.includes(clientId)) continue;
    or.push(
      projectField ? { clientId, [projectField]: { in: projects } } : { clientId: { in: [] } },
    );
  }
  const base: Record<string, unknown> = { OR: or };
  if (r.projectId && projectField) base[projectField] = r.projectId;
  return base;
}

const contains = (q: string | undefined) =>
  q?.trim() ? { contains: q.trim(), mode: "insensitive" as const } : undefined;

// ---- Projects ----------------------------------------------------------------------------------

export type ProjectFilters = Selection & Page & { q?: string; status?: string; kind?: string };

export async function listProjects(actor: Actor, f: ProjectFilters = {}) {
  const r = await resolve(actor, "client.view", { clientId: f.clientId });
  const db = forClients(r.clientIds);
  const page = clampPage(f.page);
  const where: Prisma.ProjectWhereInput = {
    ...(tenantWhere(r, "id") as Prisma.ProjectWhereInput),
    archivedAt: null,
    ...(f.status ? { status: f.status as never } : {}),
    ...(f.kind ? { kind: f.kind as never } : {}),
    ...(contains(f.q) ? { name: contains(f.q) } : {}),
  };
  const [rows, total] = await Promise.all([
    db.project.findMany({
      where,
      orderBy: [{ client: { name: "asc" } }, { name: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        client: { select: { id: true, name: true } },
        _count: { select: { projectMemberships: true } },
      },
    }),
    db.project.count({ where }),
  ]);
  return paged(rows, total, page);
}

/** Projects of one client, for the project selector (only the ones this actor may open). */
export async function listProjectOptions(actor: Actor, clientId: string | undefined) {
  if (!clientId) return [];
  const r = await resolve(actor, "client.view", { clientId });
  if (r.clientIds.length === 0) return [];
  return forClients(r.clientIds).project.findMany({
    where: { ...(tenantWhere(r, "id") as Prisma.ProjectWhereInput), archivedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, isSample: true },
  });
}

// ---- Tasks -------------------------------------------------------------------------------------

export type TaskFilters = Selection &
  Page & { q?: string; status?: string; priority?: string; mine?: boolean; open?: boolean };

export async function listTasks(actor: Actor, f: TaskFilters = {}) {
  const r = await resolve(actor, "task.view", f);
  const db = forClients(r.clientIds);
  const page = clampPage(f.page);
  const where: Prisma.TaskWhereInput = {
    ...(tenantWhere(r, "projectId") as Prisma.TaskWhereInput),
    archivedAt: null,
    ...(f.status
      ? { status: f.status as never }
      : f.open
        ? { status: { notIn: ["done", "cancelled"] } }
        : {}),
    ...(f.priority ? { priority: f.priority as never } : {}),
    ...(f.mine ? { assigneeId: actor.userId } : {}),
    ...(contains(f.q) ? { title: contains(f.q) } : {}),
  };
  const [rows, total] = await Promise.all([
    db.task.findMany({
      where,
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
      },
    }),
    db.task.count({ where }),
  ]);
  return paged(rows, total, page);
}

// ---- SEO ---------------------------------------------------------------------------------------

export async function getSeoWorkspace(actor: Actor, f: Selection & Page & { q?: string } = {}) {
  const r = await resolve(actor, "seo.view", f);
  const db = forClients(r.clientIds);
  const page = clampPage(f.page);
  const seoWhere = tenantWhere(r, null) as Prisma.SeoProjectWhereInput;
  const kwWhere: Prisma.KeywordWhereInput = {
    seoProject: seoWhere.OR
      ? { is: { OR: seoWhere.OR as never, ...(r.projectId ? { projectId: r.projectId } : {}) } }
      : undefined,
    clientId: { in: r.clientIds },
    isActive: true,
    ...(contains(f.q) ? { term: contains(f.q) } : {}),
  };
  const [keywords, keywordTotal, issues, openIssueCount, audits, competitors] = await Promise.all([
    db.keyword.findMany({
      where: kwWhere,
      orderBy: { term: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        client: { select: { name: true } },
        // Latest reading only; history stays in the table.
        keywordRankSnapshots: { orderBy: [{ checkedOn: "desc" }, { capturedAt: "desc" }], take: 1 },
      },
    }),
    db.keyword.count({ where: kwWhere }),
    db.seoIssue.findMany({
      where: { clientId: { in: r.clientIds }, status: { in: ["open", "reopened", "in_progress"] } },
      orderBy: [{ severity: "desc" }, { lastSeenAt: "desc" }],
      take: 8,
      include: { client: { select: { name: true } } },
    }),
    db.seoIssue.count({
      where: { clientId: { in: r.clientIds }, status: { in: ["open", "reopened", "in_progress"] } },
    }),
    db.siteAudit.findMany({
      where: { clientId: { in: r.clientIds } },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { client: { select: { name: true } } },
    }),
    db.competitor.count({ where: { clientId: { in: r.clientIds }, isActive: true } }),
  ]);
  return {
    keywords: paged(keywords, keywordTotal, page),
    issues,
    openIssueCount,
    audits,
    competitors,
  };
}

// ---- Content calendar ---------------------------------------------------------------------------

export type ContentFilters = Selection & Page & { q?: string; status?: string };

export async function listContent(actor: Actor, f: ContentFilters = {}) {
  const r = await resolve(actor, "content.view", f);
  const db = forClients(r.clientIds);
  const page = clampPage(f.page);
  const where: Prisma.ContentItemWhereInput = {
    ...(tenantWhere(r, "projectId") as Prisma.ContentItemWhereInput),
    archivedAt: null,
    ...(f.status ? { status: f.status as never } : {}),
    ...(contains(f.q) ? { title: contains(f.q) } : {}),
  };
  const [rows, total] = await Promise.all([
    db.contentItem.findMany({
      where,
      orderBy: [{ scheduledFor: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { client: { select: { name: true } }, project: { select: { name: true } } },
    }),
    db.contentItem.count({ where }),
  ]);
  return paged(rows, total, page);
}

// ---- Social publishing ----------------------------------------------------------------------------

export async function getPublishing(actor: Actor, f: Selection = {}) {
  const r = await resolve(actor, "content.view", { clientId: f.clientId });
  const db = forClients(r.clientIds);
  const clientIn = { clientId: { in: r.clientIds } };
  const [jobs, posts, accounts] = await Promise.all([
    db.publishingJob.findMany({
      where: clientIn,
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        client: { select: { name: true } },
        contentItem: { select: { title: true, channel: true } },
      },
    }),
    db.publishedPost.findMany({
      where: clientIn,
      orderBy: { publishedAt: "desc" },
      take: 10,
      include: { client: { select: { name: true } }, contentItem: { select: { title: true } } },
    }),
    db.integrationAccount.count({
      where: { ...clientIn, integration: { category: "social" }, status: "active" },
    }),
  ]);
  return { jobs, posts, connectedAccounts: accounts };
}

// ---- Analytics --------------------------------------------------------------------------------------

export async function getAnalytics(actor: Actor, f: Selection = {}) {
  const r = await resolve(actor, "analytics.view", { clientId: f.clientId });
  const db = forClients(r.clientIds);
  const clientIn = { clientId: { in: r.clientIds } };
  const [sources, snapshotCount, lastRun, definitions] = await Promise.all([
    db.analyticsSource.findMany({
      where: clientIn,
      orderBy: { createdAt: "desc" },
      include: {
        client: { select: { name: true } },
        integrationAccount: { select: { status: true } },
      },
    }),
    db.metricSnapshot.count({ where: clientIn }),
    db.syncRun.findFirst({
      where: clientIn,
      orderBy: { createdAt: "desc" },
      select: { status: true, createdAt: true },
    }),
    getUnscopedPrisma().metricDefinition.findMany({
      where: { isActive: true },
      orderBy: { key: "asc" },
      select: { key: true, name: true },
    }),
  ]);
  return { sources, snapshotCount, lastRun, definitions };
}

// ---- Reports -------------------------------------------------------------------------------------------

export async function listReports(actor: Actor, f: Selection & Page & { status?: string } = {}) {
  const r = await resolve(actor, "report.view", { clientId: f.clientId });
  const db = forClients(r.clientIds);
  const page = clampPage(f.page);
  const where: Prisma.ReportWhereInput = {
    clientId: { in: r.clientIds },
    ...(f.status ? { status: f.status as never } : {}),
  };
  const [rows, total] = await Promise.all([
    db.report.findMany({
      where,
      orderBy: { periodEnd: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { client: { select: { name: true } }, template: { select: { name: true } } },
    }),
    db.report.count({ where }),
  ]);
  return paged(rows, total, page);
}

// ---- Automation rules ----------------------------------------------------------------------------------------

export async function listAutomationRules(
  actor: Actor,
  f: Selection & Page & { status?: string } = {},
) {
  const r = await resolve(actor, "automation.manage", { clientId: f.clientId });
  const db = forClients(r.clientIds);
  const page = clampPage(f.page);
  const where: Prisma.AutomationRuleWhereInput = {
    clientId: { in: r.clientIds },
    archivedAt: null,
    ...(f.status ? { status: f.status as never } : {}),
  };
  const [rows, total] = await Promise.all([
    db.automationRule.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { client: { select: { name: true } } },
    }),
    db.automationRule.count({ where }),
  ]);
  return paged(rows, total, page);
}

// ---- Integrations --------------------------------------------------------------------------------------------------

export async function getIntegrations(actor: Actor, f: Selection = {}) {
  const r = await resolve(actor, "integration.manage", { clientId: f.clientId });
  const db = forClients(r.clientIds);
  const [catalogue, accounts] = await Promise.all([
    getUnscopedPrisma().integration.findMany({
      where: { isEnabled: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    db.integrationAccount.findMany({
      where: { clientId: { in: r.clientIds } },
      orderBy: { createdAt: "desc" },
      // Never select credentials: the page only needs status.
      select: {
        id: true,
        status: true,
        displayName: true,
        lastSyncedAt: true,
        integrationId: true,
        client: { select: { name: true } },
      },
    }),
  ]);
  return { catalogue, accounts };
}

// ---- Notifications -----------------------------------------------------------------------------------------------------

/** The actor's own notifications. Client-linked ones only while they can still reach that client. */
export async function listNotifications(actor: Actor, limit = 15) {
  const map = await getAccessMap(actor);
  const where: Prisma.NotificationWhereInput = {
    userId: actor.userId,
    OR: [{ clientId: null }, { clientId: { in: [...map.keys()] } }],
  };
  const prisma = getUnscopedPrisma();
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: limit }),
    prisma.notification.count({ where: { ...where, readAt: null } }),
  ]);
  return { items, unread };
}

export async function markNotificationsRead(actor: Actor, ids?: string[]) {
  await getUnscopedPrisma().notification.updateMany({
    where: { userId: actor.userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
}

// ---- Overview ---------------------------------------------------------------------------------------------------------------

export type OverviewSections = {
  tasks: boolean;
  content: boolean;
  seo: boolean;
  integrations: boolean;
};

/**
 * Everything the Overview page shows, limited to what the actor may see for the selected client/project.
 * Sections the actor has no permission for are reported as unavailable instead of rendered empty.
 */
export async function getOverview(actor: Actor, selection: Selection = {}) {
  const map = await getAccessMap(actor);
  const sel = { clientId: selection.clientId };
  const [taskScope, contentScope, seoScope, integrationScope, viewScope] = await Promise.all([
    resolve(actor, "task.view", selection),
    resolve(actor, "content.view", selection),
    resolve(actor, "seo.view", sel),
    resolve(actor, "integration.manage", sel),
    resolve(actor, "client.view", sel),
  ]);
  const sections: OverviewSections = {
    tasks: clientIdsWith(map, "task.view").length > 0,
    content: clientIdsWith(map, "content.view").length > 0,
    seo: clientIdsWith(map, "seo.view").length > 0,
    integrations: clientIdsWith(map, "integration.manage").length > 0,
  };
  const now = new Date();
  const soon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const tdb = forClients(taskScope.clientIds);
  const cdb = forClients(contentScope.clientIds);
  const sdb = forClients(seoScope.clientIds);
  const idb = forClients(integrationScope.clientIds);
  const vdb = forClients(viewScope.clientIds);
  const taskBase = {
    ...(tenantWhere(taskScope, "projectId") as Prisma.TaskWhereInput),
    archivedAt: null,
  };
  const open: Prisma.TaskWhereInput = { ...taskBase, status: { notIn: ["done", "cancelled"] } };
  const contentBase = {
    ...(tenantWhere(contentScope, "projectId") as Prisma.ContentItemWhereInput),
    archivedAt: null,
  };

  const [
    clientGroups,
    openTasks,
    overdueTasks,
    myTasks,
    myTaskCount,
    pendingApprovals,
    upcomingContent,
    upcomingContentCount,
    issueGroups,
    attentionAccounts,
    failedSyncs,
    activity,
    sampleTasks,
    sampleContent,
  ] = await Promise.all([
    vdb.client.groupBy({ by: ["status"], _count: { _all: true } }),
    tdb.task.count({ where: open }),
    tdb.task.count({ where: { ...open, dueAt: { lt: now } } }),
    tdb.task.findMany({
      where: { ...open, assigneeId: actor.userId },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }],
      take: 5,
      include: { client: { select: { name: true } } },
    }),
    tdb.task.count({ where: { ...open, assigneeId: actor.userId } }),
    cdb.contentApproval.count({
      where: { clientId: { in: contentScope.clientIds }, status: "pending" },
    }),
    cdb.contentItem.findMany({
      where: { ...contentBase, scheduledFor: { gte: now, lte: soon } },
      orderBy: { scheduledFor: "asc" },
      take: 5,
      include: { client: { select: { name: true } } },
    }),
    cdb.contentItem.count({ where: { ...contentBase, scheduledFor: { gte: now, lte: soon } } }),
    sdb.seoIssue.groupBy({
      by: ["severity"],
      where: {
        clientId: { in: seoScope.clientIds },
        status: { in: ["open", "reopened", "in_progress"] },
      },
      _count: { _all: true },
    }),
    idb.integrationAccount.count({
      where: {
        clientId: { in: integrationScope.clientIds },
        status: { in: ["needs_reauth", "error"] },
      },
    }),
    idb.syncRun.count({
      where: {
        clientId: { in: integrationScope.clientIds },
        status: "failed",
        createdAt: { gte: weekAgo },
      },
    }),
    vdb.auditLog.findMany({
      where: { clientId: { in: viewScope.clientIds }, NOT: { action: { startsWith: "auth" } } },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    tdb.task.count({ where: { ...taskBase, isSample: true } }),
    cdb.contentItem.count({ where: { ...contentBase, isSample: true } }),
  ]);

  const count = (status: string) => clientGroups.find((g) => g.status === status)?._count._all ?? 0;
  return {
    sections,
    clients: { active: count("active"), paused: count("paused"), archived: count("archived") },
    tasks: { open: openTasks, overdue: overdueTasks, mine: myTasks, mineCount: myTaskCount },
    content: { pendingApprovals, upcoming: upcomingContent, upcomingCount: upcomingContentCount },
    seo: {
      openIssues: issueGroups.reduce((n, g) => n + g._count._all, 0),
      critical: issueGroups
        .filter((g) => g.severity === "critical" || g.severity === "high")
        .reduce((n, g) => n + g._count._all, 0),
    },
    integrations: { needAttention: attentionAccounts, failedSyncs },
    activity,
    sample: { tasks: sampleTasks, content: sampleContent },
  };
}
