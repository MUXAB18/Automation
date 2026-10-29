import { clientIdsWith, forClients, getAccessMap, getClientContext, type Actor } from "../access";
import { dateInTimeZone, daysOfMonth, startOfDayInTimeZone } from "../dates";
import { NotFoundError } from "../errors";
import type { Prisma } from "../generated/client";
import { getUnscopedPrisma } from "../unsafe";
import { PAGE_SIZE, clampPage, paged } from "./paging";
import {
  OPEN_STATUSES,
  TASK_STATUSES,
  allowedMoves,
  isClosed,
  isOverdue,
  type TaskStatusName,
} from "./task-rules";
import { resolve, tenantWhere, type Selection } from "./workspace";

/**
 * Read models for the task pages. Like every section read model they start from `resolve(...)`: only
 * clients where the actor holds task.view, narrowed to the header's client/project, queried through the
 * scoped client. Overdue means "due date has passed and not completed or cancelled" everywhere.
 */

export type TaskFilters = Selection & {
  q?: string;
  status?: TaskStatusName;
  priority?: string;
  type?: string;
  /** "me", "none" (unassigned) or a user id. */
  assignee?: string;
  open?: boolean;
  overdue?: boolean;
  page?: number;
  now?: Date;
};

const OPEN = { notIn: ["completed", "cancelled"] as TaskStatusName[] };

function buildWhere(
  actor: Actor,
  r: Awaited<ReturnType<typeof resolve>>,
  f: TaskFilters,
): Prisma.TaskWhereInput {
  const now = f.now ?? new Date();
  const q = f.q?.trim();
  const and: Prisma.TaskWhereInput[] = [];
  if (f.overdue) and.push({ dueAt: { lt: now }, status: OPEN });
  if (f.open) and.push({ status: OPEN });
  if (f.assignee === "me") and.push({ assigneeId: actor.userId });
  else if (f.assignee === "none") and.push({ assigneeId: null });
  else if (f.assignee) and.push({ assigneeId: f.assignee });
  return {
    ...(tenantWhere(r, "projectId") as Prisma.TaskWhereInput),
    archivedAt: null,
    ...(f.status ? { status: f.status } : {}),
    ...(f.priority ? { priority: f.priority as never } : {}),
    ...(f.type ? { type: f.type as never } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(and.length ? { AND: and } : {}),
  };
}

const LIST_INCLUDE = {
  client: { select: { id: true, name: true, timezone: true } },
  project: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
  _count: {
    select: {
      comments: { where: { deletedAt: null } },
      attachments: { where: { deletedAt: null } },
    },
  },
} satisfies Prisma.TaskInclude;

/** How many unfinished tasks each of these tasks is still waiting for. */
async function openDependencyCounts(taskIds: string[]): Promise<Map<string, number>> {
  if (taskIds.length === 0) return new Map();
  const groups = await getUnscopedPrisma().taskDependency.groupBy({
    by: ["taskId"],
    where: { taskId: { in: taskIds }, dependsOnTask: { status: OPEN } },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.taskId, g._count._all]));
}

export type TaskSort = "due" | "recent" | "priority";

/** All Tasks / My Tasks / Overdue / filtered lists. */
export async function searchTasks(actor: Actor, f: TaskFilters & { sort?: TaskSort } = {}) {
  const r = await resolve(actor, "task.view", f);
  const db = forClients(r.clientIds);
  const page = clampPage(f.page);
  const where = buildWhere(actor, r, f);
  const now = f.now ?? new Date();
  const orderBy: Prisma.TaskOrderByWithRelationInput[] =
    f.sort === "recent"
      ? [{ updatedAt: "desc" }]
      : f.sort === "priority"
        ? [{ priority: "desc" }, { dueAt: { sort: "asc", nulls: "last" } }]
        : [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }];
  const [rows, total] = await Promise.all([
    db.task.findMany({
      where,
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: LIST_INCLUDE,
    }),
    db.task.count({ where }),
  ]);
  return paged(
    rows.map((t) => ({ ...t, overdue: isOverdue(t, now) })),
    total,
    page,
  );
}

/** Counts for the view tabs (so "Overdue 3" and "Review queue 2" are visible before opening them). */
export async function getTaskCounts(actor: Actor, f: Selection = {}) {
  const r = await resolve(actor, "task.view", f);
  const db = forClients(r.clientIds);
  const now = new Date();
  const base = tenantWhere(r, "projectId") as Prisma.TaskWhereInput;
  const reviewClients = clientIdsWith(await getAccessMap(actor), "task.review").filter((id) =>
    r.clientIds.includes(id),
  );
  const [open, mine, overdue, review] = await Promise.all([
    db.task.count({ where: { ...base, archivedAt: null, status: OPEN } }),
    db.task.count({ where: { ...base, archivedAt: null, status: OPEN, assigneeId: actor.userId } }),
    db.task.count({ where: { ...base, archivedAt: null, status: OPEN, dueAt: { lt: now } } }),
    reviewClients.length
      ? db.task.count({
          where: {
            ...base,
            archivedAt: null,
            status: "ready_for_review",
            clientId: { in: reviewClients },
          },
        })
      : Promise.resolve(0),
  ]);
  const map = await getAccessMap(actor);
  const creatable = clientIdsWith(map, "task.manage").filter((id) => r.clientIds.includes(id));
  return {
    open,
    mine,
    overdue,
    review,
    canReview: reviewClients.length > 0,
    canCreate: creatable.length > 0,
  };
}

// ---- Board -----------------------------------------------------------------------------------------

export const BOARD_COLUMNS: TaskStatusName[] = [
  "backlog",
  "assigned",
  "in_progress",
  "changes_requested",
  "blocked",
  "ready_for_review",
  "approved",
  "completed",
];
const CARDS_PER_COLUMN = 30;

/**
 * The Kanban board: one column per status. Each card carries the moves THIS person may make (so the
 * board only offers what the server will accept). Completed shows the last 14 days; cancelled is left off.
 */
export async function getBoard(actor: Actor, f: TaskFilters = {}) {
  const r = await resolve(actor, "task.view", f);
  const db = forClients(r.clientIds);
  const now = f.now ?? new Date();
  const map = await getAccessMap(actor);
  const base = buildWhere(actor, r, { ...f, status: undefined, open: false });
  const recent = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const columns = await Promise.all(
    BOARD_COLUMNS.map(async (status) => {
      const where: Prisma.TaskWhereInput = {
        ...base,
        status,
        ...(status === "completed" ? { completedAt: { gte: recent } } : {}),
      };
      const [cards, total] = await Promise.all([
        db.task.findMany({
          where,
          orderBy:
            status === "completed"
              ? [{ completedAt: "desc" }]
              : [{ priority: "desc" }, { dueAt: { sort: "asc", nulls: "last" } }],
          take: CARDS_PER_COLUMN,
          include: LIST_INCLUDE,
        }),
        db.task.count({ where }),
      ]);
      return { status, total, cards };
    }),
  );
  const allCards = columns.flatMap((c) => c.cards);
  const deps = await openDependencyCounts(allCards.map((c) => c.id));
  return {
    columns: columns.map((c) => ({
      ...c,
      cards: c.cards.map((t) => ({
        ...t,
        overdue: isOverdue(t, now),
        moves: allowedMoves(
          {
            status: t.status,
            openDependencies: deps.get(t.id) ?? 0,
            hasAssignee: t.assigneeId !== null,
          },
          {
            userId: actor.userId,
            permissions: map.get(t.clientId)?.permissions ?? new Set(),
            assigneeId: t.assigneeId,
            reporterId: t.reporterId,
          },
        ),
      })),
    })),
  };
}

// ---- Calendar ----------------------------------------------------------------------------------------

/** Tasks with a due date in `month` (YYYY-MM), grouped by the day they fall on in their CLIENT's time zone. */
export async function getCalendar(actor: Actor, month: string, f: TaskFilters = {}) {
  const r = await resolve(actor, "task.view", f);
  const db = forClients(r.clientIds);
  const now = f.now ?? new Date();
  const days = daysOfMonth(month);
  // Widen by a day each side: the month's edges differ by time zone.
  const from = new Date(startOfDayInTimeZone(days[0]!, "UTC").getTime() - 24 * 60 * 60 * 1000);
  const to = new Date(
    startOfDayInTimeZone(days[days.length - 1]!, "UTC").getTime() + 48 * 60 * 60 * 1000,
  );
  const where = {
    ...buildWhere(actor, r, { ...f, status: undefined }),
    dueAt: { gte: from, lt: to },
  } satisfies Prisma.TaskWhereInput;
  const tasks = await db.task.findMany({
    where,
    orderBy: [{ dueAt: "asc" }],
    take: 500,
    include: LIST_INCLUDE,
  });
  const byDay = new Map<string, ((typeof tasks)[number] & { overdue: boolean })[]>();
  for (const t of tasks) {
    const day = dateInTimeZone(t.dueAt!, t.client.timezone);
    if (!day.startsWith(month)) continue;
    byDay.set(day, [...(byDay.get(day) ?? []), { ...t, overdue: isOverdue(t, now) }]);
  }
  const undated = await db.task.count({
    where: { ...buildWhere(actor, r, { ...f, status: undefined, open: true }), dueAt: null },
  });
  return { days, byDay, undated, truncated: tasks.length === 500 };
}

// ---- Workload ----------------------------------------------------------------------------------------

export type WorkloadRow = {
  userId: string;
  name: string;
  email: string;
  open: number;
  overdue: number;
  dueThisWeek: number;
  inReview: number;
  blocked: number;
  estimateMinutes: number;
  loggedMinutes7d: number;
};

/** People who can do tasks on any of these clients (so people with zero tasks still appear). */
async function listDoers(clientIds: string[], agencyIds: string[]) {
  const prisma = getUnscopedPrisma();
  const can = {
    some: { role: { rolePermissions: { some: { permission: { key: "task.manage" } } } } },
  };
  const active = { deactivatedAt: null };
  const [direct, wide] = await Promise.all([
    prisma.clientMembership.findMany({
      where: {
        clientId: { in: clientIds },
        status: "active",
        roles: can,
        agencyMembership: { status: "active", user: active },
      },
      select: {
        agencyMembership: { select: { user: { select: { id: true, name: true, email: true } } } },
      },
    }),
    prisma.agencyMembership.findMany({
      where: {
        agencyId: { in: agencyIds },
        status: "active",
        allClientsAccess: true,
        roles: can,
        user: active,
      },
      select: { user: { select: { id: true, name: true, email: true } } },
    }),
  ]);
  const people = new Map<string, { id: string; name: string; email: string }>();
  for (const m of direct) people.set(m.agencyMembership.user.id, m.agencyMembership.user);
  for (const m of wide) people.set(m.user.id, m.user);
  return [...people.values()];
}

/** Team workload: open work, overdue, due soon, estimated effort and recent time logged, per person. */
export async function getWorkload(actor: Actor, f: Selection & { now?: Date } = {}) {
  const r = await resolve(actor, "task.view", f);
  const db = forClients(r.clientIds);
  const now = f.now ?? new Date();
  const week = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const base = {
    ...(tenantWhere(r, "projectId") as Prisma.TaskWhereInput),
    archivedAt: null,
    status: OPEN,
  };

  const [open, overdue, soon, review, blocked, time, clients] = await Promise.all([
    db.task.groupBy({
      by: ["assigneeId"],
      where: base,
      _count: { _all: true },
      _sum: { estimateMinutes: true },
    }),
    db.task.groupBy({
      by: ["assigneeId"],
      where: { ...base, dueAt: { lt: now } },
      _count: { _all: true },
    }),
    db.task.groupBy({
      by: ["assigneeId"],
      where: { ...base, dueAt: { gte: now, lte: week } },
      _count: { _all: true },
    }),
    db.task.groupBy({
      by: ["assigneeId"],
      where: { ...base, status: "ready_for_review" },
      _count: { _all: true },
    }),
    db.task.groupBy({
      by: ["assigneeId"],
      where: { ...base, status: "blocked" },
      _count: { _all: true },
    }),
    db.timeEntry.groupBy({
      by: ["userId"],
      where: { clientId: { in: r.clientIds }, startedAt: { gte: weekAgo } },
      _sum: { durationSeconds: true },
    }),
    getUnscopedPrisma().client.findMany({
      where: { id: { in: r.clientIds } },
      select: { agencyId: true },
    }),
  ]);
  const doers = await listDoers(r.clientIds, [...new Set(clients.map((c) => c.agencyId))]);

  const count = (
    rows: { assigneeId: string | null; _count: { _all: number } }[],
    id: string | null,
  ) => rows.find((x) => x.assigneeId === id)?._count._all ?? 0;
  const ids = new Set<string>(doers.map((d) => d.id));
  for (const g of open) if (g.assigneeId) ids.add(g.assigneeId);
  const known = new Map(doers.map((d) => [d.id, d]));
  const missing = [...ids].filter((id) => !known.has(id));
  if (missing.length) {
    for (const u of await getUnscopedPrisma().user.findMany({
      where: { id: { in: missing } },
      select: { id: true, name: true, email: true },
    }))
      known.set(u.id, u);
  }

  const rows: WorkloadRow[] = [...ids].map((id) => {
    const u = known.get(id)!;
    return {
      userId: id,
      name: u.name,
      email: u.email,
      open: count(open, id),
      overdue: count(overdue, id),
      dueThisWeek: count(soon, id),
      inReview: count(review, id),
      blocked: count(blocked, id),
      estimateMinutes: open.find((x) => x.assigneeId === id)?._sum.estimateMinutes ?? 0,
      loggedMinutes7d: Math.round(
        (time.find((x) => x.userId === id)?._sum.durationSeconds ?? 0) / 60,
      ),
    };
  });
  rows.sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
  return {
    rows,
    unassigned: { open: count(open, null), overdue: count(overdue, null) },
    canReassign: clientIdsWith(await getAccessMap(actor), "task.assign").some((id) =>
      r.clientIds.includes(id),
    ),
  };
}

// ---- Review queue --------------------------------------------------------------------------------------

/** Tasks waiting for a decision, on the clients where this person can review, oldest request first. */
export async function getReviewQueue(actor: Actor, f: Selection & { page?: number } = {}) {
  const map = await getAccessMap(actor);
  const reviewable = clientIdsWith(map, "task.review");
  const r = await resolve(actor, "task.view", f);
  const clientIds = r.clientIds.filter((id) => reviewable.includes(id));
  const db = forClients(clientIds);
  const page = clampPage(f.page);
  const where: Prisma.TaskWhereInput = {
    ...(tenantWhere({ ...r, clientIds }, "projectId") as Prisma.TaskWhereInput),
    archivedAt: null,
    status: "ready_for_review",
  };
  const now = new Date();
  const [rows, total] = await Promise.all([
    db.task.findMany({
      where,
      orderBy: [{ reviewRequestedAt: { sort: "asc", nulls: "last" } }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: LIST_INCLUDE,
    }),
    db.task.count({ where }),
  ]);
  return paged(
    rows.map((t) => ({ ...t, overdue: isOverdue(t, now), ownWork: t.assigneeId === actor.userId })),
    total,
    page,
  );
}

// ---- Detail -------------------------------------------------------------------------------------------------

export async function getTaskDetail(actor: Actor, taskId: string) {
  const prisma = getUnscopedPrisma();
  const found = await prisma.task.findUnique({ where: { id: taskId }, select: { clientId: true } });
  if (!found) throw new NotFoundError("Task not found");
  const ctx = await getClientContext(actor, found.clientId);
  const p = ctx.access.permissions;
  if (!p.has("task.view")) throw new NotFoundError("Task not found");

  const task = await ctx.db.task.findUnique({
    where: { id: taskId },
    include: {
      client: { select: { id: true, name: true, timezone: true } },
      project: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true, email: true } },
      reporter: { select: { id: true, name: true } },
      contentItem: { select: { id: true, title: true, status: true } },
      seoIssues: { select: { id: true, title: true, severity: true, status: true } },
      dependencies: {
        select: {
          dependsOnTaskId: true,
          dependsOnTask: { select: { id: true, title: true, status: true, dueAt: true } },
        },
      },
      dependents: {
        select: { taskId: true, task: { select: { id: true, title: true, status: true } } },
      },
      comments: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: { id: true, name: true } } },
      },
      attachments: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: { uploadedBy: { select: { name: true } } },
      },
      events: {
        orderBy: { createdAt: "desc" },
        take: 200,
        include: { actor: { select: { name: true } } },
      },
      timeEntries: {
        orderBy: { startedAt: "desc" },
        include: { user: { select: { id: true, name: true } } },
      },
    },
  });
  if (!task) throw new NotFoundError("Task not found");

  const openDependencies = task.dependencies.filter(
    (d) => !isClosed(d.dependsOnTask.status),
  ).length;
  const facts = {
    userId: actor.userId,
    permissions: ctx.access.permissions,
    assigneeId: task.assigneeId,
    reporterId: task.reporterId,
  };
  const isAssignee = task.assigneeId === actor.userId;
  const closed = isClosed(task.status);
  const canEdit =
    !closed &&
    (p.has("task.assign") ||
      (p.has("task.manage") && (isAssignee || task.reporterId === actor.userId)));
  const canAssign =
    !closed && (p.has("task.assign") || (p.has("task.manage") && task.assigneeId === null));
  const assignable = canAssign
    ? (await listDoers([task.clientId], [task.agencyId])).sort((a, b) =>
        a.name.localeCompare(b.name),
      )
    : [];

  // Names for the people mentioned in the history (assignments store ids).
  const mentioned = new Set<string>();
  for (const e of task.events) {
    if (e.type === "assigned" || e.type === "unassigned" || e.type === "reassigned") {
      for (const v of [e.fromValue, e.toValue]) if (typeof v === "string") mentioned.add(v);
    }
  }
  const userNames: Record<string, string> = {};
  if (mentioned.size) {
    const users = await prisma.user.findMany({
      where: { id: { in: [...mentioned] } },
      select: { id: true, name: true },
    });
    for (const u of users) userNames[u.id] = u.name;
  }

  // Tasks this one could wait for: same client, unfinished, not itself, not already a dependency.
  const waitingFor = new Set(task.dependencies.map((d) => d.dependsOnTaskId));
  const dependencyCandidates = canEdit
    ? (
        await ctx.db.task.findMany({
          where: { archivedAt: null, id: { not: taskId }, status: OPEN },
          orderBy: { updatedAt: "desc" },
          take: 100,
          select: { id: true, title: true, status: true },
        })
      ).filter((t) => !waitingFor.has(t.id))
    : [];

  return {
    task,
    overdue: isOverdue(task),
    loggedMinutes: Math.round(task.timeEntries.reduce((n, e) => n + e.durationSeconds, 0) / 60),
    openDependencies,
    moves: allowedMoves(
      { status: task.status, openDependencies, hasAssignee: task.assigneeId !== null },
      facts,
    ),
    permissions: {
      canEdit,
      canAssign,
      selfClaim: task.assigneeId === null && p.has("task.manage") && !p.has("task.assign"),
      canComment: p.has("task.manage") || p.has("task.review") || p.has("task.assign"),
      canLogTime:
        task.status !== "cancelled" &&
        (p.has("task.assign") || (p.has("task.manage") && isAssignee)),
      canManage: p.has("task.assign"),
    },
    assignable,
    userNames,
    dependencyCandidates,
    userId: actor.userId,
  };
}

// ---- Form options ---------------------------------------------------------------------------------------------

/** What the create/edit form needs for one client: projects, content, open SEO issues and assignable people. */
export async function getTaskFormOptions(actor: Actor, clientId: string) {
  const ctx = await getClientContext(actor, clientId);
  const p = ctx.access.permissions;
  const [client, projects, content, issues, people] = await Promise.all([
    ctx.db.client.findUnique({
      where: { id: clientId },
      select: { id: true, name: true, timezone: true },
    }),
    ctx.db.project.findMany({
      where: { archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    ctx.db.contentItem.findMany({
      where: { archivedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: { id: true, title: true },
    }),
    ctx.db.seoIssue.findMany({
      where: { status: { in: ["open", "reopened", "in_progress"] } },
      orderBy: [{ severity: "desc" }, { lastSeenAt: "desc" }],
      take: 100,
      select: { id: true, title: true, taskId: true },
    }),
    listDoers([clientId], [ctx.agencyId]),
  ]);
  return {
    client,
    projects,
    content,
    issues,
    people: people.sort((a, b) => a.name.localeCompare(b.name)),
    canCreate: p.has("task.manage"),
    canAssign: p.has("task.assign"),
  };
}

export { OPEN_STATUSES, TASK_STATUSES };

/** Clients where this person can create tasks (for the "which client?" step of the new-task form). */
export async function listClientsForTasks(actor: Actor) {
  const ids = clientIdsWith(await getAccessMap(actor), "task.manage");
  return forClients(ids).client.findMany({ where: { status: { not: "archived" } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}
