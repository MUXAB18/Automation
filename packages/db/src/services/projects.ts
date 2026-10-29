import { z } from "zod";
import {
  forClients,
  getAccessMap,
  getClientContext,
  requirePermission,
  type Actor,
  type ClientContext,
} from "../access";
import { recordAudit } from "../audit";
import { authorize } from "../authorize";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import type { Prisma } from "../generated/client";
import {
  createProjectSchema,
  parseInput,
  slugify,
  socialRequirementsSchema,
  updateProjectSchema,
  type CreateProjectInput,
  type UpdateProjectInput,
} from "../schemas";
import { getUnscopedPrisma } from "../unsafe";
import { PAGE_SIZE, clampPage, paged } from "./paging";
import { resolve, tenantWhere } from "./workspace";

type Tx = Prisma.TransactionClient;
const isUniqueViolation = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";

// ---- List ------------------------------------------------------------------------------------------------

export type ProjectSearch = {
  q?: string;
  status?: string;
  kind?: string;
  /** Show archived projects instead of live ones. */
  archived?: boolean;
  /** Header selection. */
  clientId?: string;
  page?: number;
};

/**
 * The Projects page. Limited to clients where the actor can view the client; users whose only role is
 * Client see only the projects they belong to. `canManage` says whether to offer archive/restore per row.
 */
export async function searchProjects(actor: Actor, f: ProjectSearch = {}) {
  const r = await resolve(actor, "client.view", { clientId: f.clientId });
  const db = forClients(r.clientIds);
  const page = clampPage(f.page);
  const q = f.q?.trim();
  const where: Prisma.ProjectWhereInput = {
    ...(tenantWhere(r, "id") as Prisma.ProjectWhereInput),
    archivedAt: f.archived ? { not: null } : null,
    ...(f.status ? { status: f.status as never } : {}),
    ...(f.kind ? { kind: f.kind as never } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { goals: { contains: q, mode: "insensitive" } },
            { client: { name: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [rows, total, map] = await Promise.all([
    db.project.findMany({
      where,
      orderBy: [{ client: { name: "asc" } }, { name: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        client: { select: { id: true, name: true } },
        _count: {
          select: {
            projectMemberships: true,
            tasks: { where: { archivedAt: null, status: { notIn: ["completed", "cancelled"] } } },
          },
        },
      },
    }),
    db.project.count({ where }),
    getAccessMap(actor),
  ]);
  return paged(
    rows.map((p) => ({
      ...p,
      canManage: map.get(p.clientId)?.permissions.has("project.manage") ?? false,
    })),
    total,
    page,
  );
}

// ---- People who can be assigned ---------------------------------------------------------------------------

type Person = { userId: string; name: string; email: string; roles: string[] };

/** Who can be put on a project of this client: its team plus agency staff with all-clients access. */
export async function listProjectCandidates(actor: Actor, clientId: string): Promise<Person[]> {
  const ctx = await requirePermission(actor, clientId, "project.manage");
  return loadCandidates(getUnscopedPrisma(), ctx.agencyId, clientId);
}

async function loadCandidates(tx: Tx, agencyId: string, clientId: string): Promise<Person[]> {
  const [seats, wide] = await Promise.all([
    tx.clientMembership.findMany({
      where: {
        clientId,
        status: "active",
        agencyMembership: { status: "active", user: { deactivatedAt: null } },
      },
      select: {
        userId: true,
        roles: { select: { role: { select: { name: true } } } },
        agencyMembership: { select: { user: { select: { name: true, email: true } } } },
      },
    }),
    tx.agencyMembership.findMany({
      where: { agencyId, status: "active", allClientsAccess: true, user: { deactivatedAt: null } },
      select: {
        userId: true,
        user: { select: { name: true, email: true } },
        roles: { select: { role: { select: { name: true } } } },
      },
    }),
  ]);
  const people = new Map<string, Person>();
  for (const s of seats) {
    const u = s.agencyMembership.user;
    people.set(s.userId, {
      userId: s.userId,
      name: u.name,
      email: u.email,
      roles: s.roles.map((r) => r.role.name),
    });
  }
  for (const w of wide) {
    const existing = people.get(w.userId);
    const roles = w.roles.map((r) => r.role.name);
    people.set(w.userId, {
      userId: w.userId,
      name: w.user.name,
      email: w.user.email,
      roles: [...new Set([...(existing?.roles ?? []), ...roles])],
    });
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Check every id is someone who may work on this client, and give agency-wide staff a (role-less)
 * client seat so the project membership's foreign key to the client team holds.
 */
async function ensureAssignable(
  tx: Tx,
  ctx: { agencyId: string; clientId: string },
  userIds: string[],
) {
  if (userIds.length === 0) return;
  const candidates = new Set(
    (await loadCandidates(tx, ctx.agencyId, ctx.clientId)).map((c) => c.userId),
  );
  const outsiders = userIds.filter((id) => !candidates.has(id));
  if (outsiders.length > 0) {
    throw new ValidationError({
      memberIds: ["Everyone assigned must work on this client (add them to the client team first)"],
    });
  }
  const seated = new Set(
    (
      await tx.clientMembership.findMany({
        where: { clientId: ctx.clientId, userId: { in: userIds } },
        select: { userId: true },
      })
    ).map((m) => m.userId),
  );
  for (const userId of userIds.filter((id) => !seated.has(id))) {
    await tx.clientMembership.create({
      data: { agencyId: ctx.agencyId, clientId: ctx.clientId, userId },
    });
  }
}

// ---- Create ----------------------------------------------------------------------------------------------

const keywordRows = (
  c: { agencyId: string; clientId: string },
  seoProjectId: string,
  terms: string[],
  language: string,
) =>
  terms.map((term) => ({
    agencyId: c.agencyId,
    clientId: c.clientId,
    seoProjectId,
    term,
    country: "CA",
    locale: language.slice(0, 2),
  }));

function seoSettings(seo: { organicSessionsGoal?: number; topTenKeywordsGoal?: number }) {
  return {
    targets: {
      organicSessionsGoal: seo.organicSessionsGoal ?? null,
      topTenKeywordsGoal: seo.topTenKeywordsGoal ?? null,
    },
  };
}

async function ensureCalendar(
  tx: Tx,
  c: { agencyId: string; clientId: string },
  project: { id: string; name: string; slug: string },
) {
  const existing = await tx.contentCalendar.findFirst({
    where: { clientId: c.clientId, projectId: project.id },
  });
  if (existing) return existing;
  const name = (await tx.contentCalendar.findFirst({
    where: { clientId: c.clientId, name: `${project.name} calendar` },
  }))
    ? `${project.name} calendar (${project.slug})`
    : `${project.name} calendar`;
  return tx.contentCalendar.create({
    data: { agencyId: c.agencyId, clientId: c.clientId, projectId: project.id, name },
  });
}

const snap = (p: {
  name: string;
  kind: string;
  status: string;
  goals: string | null;
  startsOn: Date | null;
  endsOn: Date | null;
}) => ({
  name: p.name,
  kind: p.kind,
  status: p.status,
  goals: p.goals,
  startsOn: p.startsOn?.toISOString().slice(0, 10) ?? null,
  endsOn: p.endsOn?.toISOString().slice(0, 10) ?? null,
});

/**
 * Create a project with everything configured on the form, in ONE transaction: the project, its
 * assigned people, its SEO setup (SEO project + tracked keywords) and its social setup (requirements +
 * a content calendar). If any part fails - say the website belongs to another client - nothing is kept.
 */
export async function createProject(actor: Actor, input: CreateProjectInput) {
  const data = parseInput(createProjectSchema, input);
  const ctx = await requirePermission(actor, data.clientId, "project.manage");
  if (data.seo && !ctx.access.permissions.has("seo.manage")) {
    throw new ForbiddenError("You need SEO permissions to set SEO targets");
  }
  const prisma = getUnscopedPrisma();
  const base = slugify(data.name);

  for (let attempt = 0; attempt < 20; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`.slice(0, 60);
    try {
      return await prisma.$transaction(async (tx) => {
        const tenant = { agencyId: ctx.agencyId, clientId: ctx.clientId };
        const project = await tx.project.create({
          data: {
            ...tenant,
            name: data.name,
            slug,
            kind: data.kind,
            status: data.status,
            description: data.description ?? null,
            goals: data.goals ?? null,
            startsOn: data.startsOn ?? null,
            endsOn: data.endsOn ?? null,
            createdById: actor.userId,
            settings: data.social ? { social: data.social } : {},
            archivedAt: data.status === "archived" ? new Date() : null,
          },
        });

        await ensureAssignable(tx, ctx, data.memberIds);
        await tx.projectMembership.createMany({
          data: data.memberIds.map((userId) => ({
            ...tenant,
            projectId: project.id,
            userId,
            role: "contributor" as const,
          })),
        });

        if (data.seo) {
          const site = await tx.website.findFirst({
            where: { id: data.seo.websiteId, clientId: ctx.clientId },
            select: { id: true },
          });
          if (!site)
            throw new ValidationError({
              "seo.websiteId": ["Choose one of this client's websites"],
            });
          const seo = await tx.seoProject.create({
            data: {
              ...tenant,
              projectId: project.id,
              websiteId: site.id,
              targetCountry: data.seo.targetCountry,
              targetLanguage: data.seo.targetLanguage,
              settings: seoSettings(data.seo),
            },
          });
          await tx.keyword.createMany({
            data: keywordRows(tenant, seo.id, data.seo.keywords, data.seo.targetLanguage),
            skipDuplicates: true,
          });
        }
        if (data.social) await ensureCalendar(tx, tenant, project);

        await recordAudit(tx, {
          actorUserId: actor.userId,
          agencyId: ctx.agencyId,
          clientId: ctx.clientId,
          action: "project.created",
          entityType: "project",
          entityId: project.id,
          after: {
            ...snap(project),
            members: data.memberIds.length,
            seo: Boolean(data.seo),
            keywords: data.seo?.keywords.length ?? 0,
            social: Boolean(data.social),
          },
        });
        return project;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new ConflictError("Could not generate a unique project address; rename the project");
}

// ---- Read ------------------------------------------------------------------------------------------------

export async function getProjectDetail(actor: Actor, projectId: string) {
  // Verifies the project exists, belongs to a client the actor can see and, for Client users, that they were added to it.
  const ctx = await authorize(actor, { projectId }, "client.view");
  if (ctx.level !== "client") throw new NotFoundError("Project not found");
  const { db, access, clientId } = ctx;
  const has = (p: Parameters<typeof access.permissions.has>[0]) => access.permissions.has(p);

  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      client: { select: { id: true, name: true, status: true } },
      createdBy: { select: { name: true } },
      projectMemberships: {
        orderBy: { createdAt: "asc" },
        include: {
          clientMembership: {
            select: {
              roles: { select: { role: { select: { name: true } } } },
              agencyMembership: { select: { user: { select: { name: true, email: true } } } },
            },
          },
        },
      },
      seoProject: { include: { website: { select: { id: true, domain: true } } } },
    },
  });
  if (!project || project.clientId !== clientId) throw new NotFoundError("Project not found");

  const openTask: Prisma.TaskWhereInput = {
    projectId,
    archivedAt: null,
    status: { notIn: ["completed", "cancelled"] },
  };
  const seoProjectId = project.seoProject?.id;

  const [
    tasks,
    taskGroups,
    content,
    contentGroups,
    keywords,
    issues,
    sources,
    snapshots,
    activity,
  ] = await Promise.all([
    has("task.view")
      ? db.task.findMany({
          where: openTask,
          orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }],
          take: 8,
          include: { assignee: { select: { name: true } } },
        })
      : null,
    has("task.view")
      ? db.task.groupBy({
          by: ["status"],
          where: { projectId, archivedAt: null },
          _count: { _all: true },
        })
      : null,
    has("content.view")
      ? db.contentItem.findMany({
          where: { projectId, archivedAt: null },
          orderBy: [{ scheduledFor: { sort: "asc", nulls: "last" } }],
          take: 8,
        })
      : null,
    has("content.view")
      ? db.contentItem.groupBy({
          by: ["status"],
          where: { projectId, archivedAt: null },
          _count: { _all: true },
        })
      : null,
    has("seo.view") && seoProjectId
      ? db.keyword.findMany({
          where: { seoProjectId, isActive: true },
          orderBy: { term: "asc" },
          take: 50,
          include: {
            keywordRankSnapshots: {
              orderBy: [{ checkedOn: "desc" }, { capturedAt: "desc" }],
              take: 1,
            },
          },
        })
      : null,
    has("seo.view") && seoProjectId
      ? db.seoIssue.findMany({
          where: { seoProjectId, status: { in: ["open", "reopened", "in_progress"] } },
          orderBy: [{ severity: "desc" }, { lastSeenAt: "desc" }],
          take: 8,
        })
      : null,
    has("analytics.view") && project.seoProject
      ? db.analyticsSource.findMany({
          where: { websiteId: project.seoProject.websiteId },
          select: { id: true, kind: true, displayName: true, externalId: true, lastSyncedAt: true },
        })
      : null,
    has("analytics.view") && project.seoProject
      ? db.metricSnapshot.count({
          where: { analyticsSource: { websiteId: project.seoProject.websiteId } },
        })
      : null,
    db.auditLog.findMany({
      where: { entityType: "project", entityId: projectId },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { actor: { select: { name: true } } },
    }),
  ]);

  const social = socialRequirementsSchema.safeParse(
    (project.settings as { social?: unknown } | null)?.social,
  );
  const ranked = (keywords ?? [])
    .map((k) => k.keywordRankSnapshots[0]?.position)
    .filter((p): p is NonNullable<typeof p> => p !== null && p !== undefined);
  return {
    project,
    social: social.success ? social.data : null,
    tasks:
      tasks && taskGroups
        ? {
            open: tasks,
            counts: Object.fromEntries(taskGroups.map((g) => [g.status, g._count._all])),
          }
        : null,
    content:
      content && contentGroups
        ? {
            items: content,
            counts: Object.fromEntries(contentGroups.map((g) => [g.status, g._count._all])),
          }
        : null,
    seo: project.seoProject
      ? {
          keywords: keywords ?? null,
          issues,
          targets:
            (
              project.seoProject.settings as {
                targets?: {
                  organicSessionsGoal?: number | null;
                  topTenKeywordsGoal?: number | null;
                };
              } | null
            )?.targets ?? {},
          avgPosition: ranked.length
            ? ranked.reduce((n, p) => n + Number(p), 0) / ranked.length
            : null,
          rankedCount: ranked.length,
        }
      : null,
    metrics: sources ? { sources, snapshotCount: snapshots ?? 0 } : null,
    activity,
    canManage: has("project.manage"),
    canManageSeo: has("seo.manage"),
    access,
  };
}

// ---- Update ----------------------------------------------------------------------------------------------

async function loadForUpdate(actor: Actor, projectId: string, permission: "project.manage") {
  const ctx = await authorize(actor, { projectId }, permission);
  if (ctx.level !== "client") throw new NotFoundError("Project not found");
  return ctx as Extract<typeof ctx, { level: "client" }> & ClientContext;
}

export async function updateProject(actor: Actor, projectId: string, input: UpdateProjectInput) {
  const data = parseInput(updateProjectSchema, input);
  const ctx = await loadForUpdate(actor, projectId, "project.manage");
  if (data.seo && !ctx.access.permissions.has("seo.manage"))
    throw new ForbiddenError("You need SEO permissions to change SEO targets");
  const prisma = getUnscopedPrisma();

  return prisma.$transaction(async (tx) => {
    const tenant = { agencyId: ctx.agencyId, clientId: ctx.clientId };
    const before = await tx.project.findFirst({
      where: { id: projectId, clientId: ctx.clientId },
      include: { projectMemberships: { select: { userId: true } } },
    });
    if (!before) throw new NotFoundError("Project not found");

    const settings =
      typeof before.settings === "object" && before.settings !== null
        ? { ...(before.settings as Record<string, unknown>) }
        : {};
    if (data.social) settings.social = data.social;
    const after = await tx.project.update({
      where: { id: projectId },
      data: {
        name: data.name,
        kind: data.kind,
        status: data.status,
        description: data.description ?? null,
        goals: data.goals ?? null,
        startsOn: data.startsOn ?? null,
        endsOn: data.endsOn ?? null,
        settings: settings as Prisma.InputJsonValue,
        archivedAt: data.status === "archived" ? (before.archivedAt ?? new Date()) : null,
      },
    });

    // Replace the assignment list: add the new people, remove the ones taken off.
    const before_ids = before.projectMemberships.map((m) => m.userId);
    await ensureAssignable(tx, ctx, data.memberIds);
    await tx.projectMembership.deleteMany({
      where: { projectId, userId: { notIn: data.memberIds } },
    });
    const toAdd = data.memberIds.filter((id) => !before_ids.includes(id));
    await tx.projectMembership.createMany({
      data: toAdd.map((userId) => ({ ...tenant, projectId, userId, role: "contributor" as const })),
    });

    if (data.seo) {
      const site = await tx.website.findFirst({
        where: { id: data.seo.websiteId, clientId: ctx.clientId },
        select: { id: true },
      });
      if (!site)
        throw new ValidationError({ "seo.websiteId": ["Choose one of this client's websites"] });
      const seo = await tx.seoProject.upsert({
        where: { projectId_clientId: { projectId, clientId: ctx.clientId } },
        update: {
          websiteId: site.id,
          targetCountry: data.seo.targetCountry,
          targetLanguage: data.seo.targetLanguage,
          settings: seoSettings(data.seo),
        },
        create: {
          ...tenant,
          projectId,
          websiteId: site.id,
          targetCountry: data.seo.targetCountry,
          targetLanguage: data.seo.targetLanguage,
          settings: seoSettings(data.seo),
        },
      });
      // The keyword list is the desired set: keep history by switching dropped terms off, never deleting.
      const existing = await tx.keyword.findMany({ where: { seoProjectId: seo.id } });
      const wanted = new Set(data.seo.keywords);
      for (const k of existing) {
        if (k.isActive !== wanted.has(k.term))
          await tx.keyword.update({ where: { id: k.id }, data: { isActive: wanted.has(k.term) } });
      }
      const known = new Set(existing.map((k) => k.term));
      await tx.keyword.createMany({
        data: keywordRows(
          tenant,
          seo.id,
          data.seo.keywords.filter((t) => !known.has(t)),
          data.seo.targetLanguage,
        ),
        skipDuplicates: true,
      });
    }
    if (data.social) await ensureCalendar(tx, tenant, after);

    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: ctx.clientId,
      action: "project.updated",
      entityType: "project",
      entityId: projectId,
      before: { ...snap(before), members: before_ids.length },
      after: {
        ...snap(after),
        members: data.memberIds.length,
        seo: Boolean(data.seo),
        social: Boolean(data.social),
      },
    });
    return after;
  });
}

/** Archive or restore (or pause/complete) a project. Archiving keeps all of its history. */
export async function setProjectStatus(
  actor: Actor,
  projectId: string,
  status: "active" | "paused" | "completed" | "archived",
) {
  const next = parseInput(z.enum(["active", "paused", "completed", "archived"]), status);
  const ctx = await loadForUpdate(actor, projectId, "project.manage");
  return ctx.db.$transaction(async (tx) => {
    const before = await tx.project.findUnique({ where: { id: projectId } });
    if (!before) throw new NotFoundError("Project not found");
    if (before.status === next) return before;
    const after = await tx.project.update({
      where: { id: projectId },
      data: { status: next, archivedAt: next === "archived" ? new Date() : null },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: ctx.clientId,
      action: "project.status_changed",
      entityType: "project",
      entityId: projectId,
      before: { status: before.status },
      after: { status: after.status },
    });
    return after;
  });
}

/** For the edit form: the project as the form needs it. */
export async function getProjectForEdit(actor: Actor, projectId: string) {
  const ctx = await loadForUpdate(actor, projectId, "project.manage");
  const project = await ctx.db.project.findUnique({
    where: { id: projectId },
    include: {
      projectMemberships: { select: { userId: true } },
      seoProject: {
        include: {
          keywords: { where: { isActive: true }, orderBy: { term: "asc" }, select: { term: true } },
        },
      },
    },
  });
  if (!project) throw new NotFoundError("Project not found");
  const websites = await ctx.db.website.findMany({
    where: { clientId: ctx.clientId },
    orderBy: [{ isPrimary: "desc" }, { domain: "asc" }],
    select: { id: true, domain: true },
  });
  const candidates = await loadCandidates(getUnscopedPrisma(), ctx.agencyId, ctx.clientId);
  const social = socialRequirementsSchema.safeParse(
    (project.settings as { social?: unknown } | null)?.social,
  );
  return {
    project,
    social: social.success ? social.data : null,
    seoTargets:
      (project.seoProject?.settings as { targets?: Record<string, number | null> } | null)
        ?.targets ?? {},
    websites,
    candidates,
    canManageSeo: ctx.access.permissions.has("seo.manage"),
  };
}

/** For the create form. */
export async function getProjectFormOptions(actor: Actor, clientId: string) {
  const ctx = await requirePermission(actor, clientId, "project.manage");
  const [websites, candidates, client] = await Promise.all([
    ctx.db.website.findMany({
      where: { clientId },
      orderBy: [{ isPrimary: "desc" }, { domain: "asc" }],
      select: { id: true, domain: true },
    }),
    loadCandidates(getUnscopedPrisma(), ctx.agencyId, clientId),
    getClientContext(actor, clientId).then((c) =>
      c.db.client.findUnique({ where: { id: clientId }, select: { id: true, name: true } }),
    ),
  ]);
  return { client, websites, candidates, canManageSeo: ctx.access.permissions.has("seo.manage") };
}

/** Clients in which the actor may create projects (for the "which client?" choice). */
export async function listClientsForProjects(actor: Actor) {
  const map = await getAccessMap(actor);
  const ids = [...map].filter(([, e]) => e.permissions.has("project.manage")).map(([id]) => id);
  return forClients(ids).client.findMany({
    where: { status: { not: "archived" } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}
