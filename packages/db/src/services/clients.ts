import {
  getAccessMap,
  getActorDb,
  getClientContext,
  listAgenciesWith,
  requirePermission,
  type Actor,
} from "../access";
import { recordAudit } from "../audit";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import type { ClientStatus } from "../generated/enums";
import type { Prisma } from "../generated/client";
import { isClientRoleOnly } from "../permissions";
import {
  addWebsiteSchema,
  clientPreferencesSchema,
  createClientSchema,
  clientStatusSchema,
  parseInput,
  slugify,
  updateClientSchema,
  type AddWebsiteInput,
  type CreateClientInput,
  type UpdateClientInput,
} from "../schemas";
import { getUnscopedPrisma } from "../unsafe";
import { PAGE_SIZE, clampPage, paged } from "./paging";

const isUniqueViolation = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";

type Tx = Prisma.TransactionClient;

const snapshot = (c: {
  name: string;
  slug: string;
  status: string;
  industry: string | null;
  goals: string | null;
  targetLocations: string[];
  timezone: string;
  locale: string;
  reportEmail: string | null;
  reportIntervalDays: number;
  accountOwnerId: string | null;
}) => ({
  name: c.name,
  slug: c.slug,
  status: c.status,
  industry: c.industry,
  goals: c.goals,
  targetLocations: c.targetLocations,
  timezone: c.timezone,
  locale: c.locale,
  reportEmail: c.reportEmail,
  reportIntervalDays: c.reportIntervalDays,
  accountOwnerId: c.accountOwnerId,
});

/** Preferences live in clients.settings.preferences; other keys in settings are left alone. */
export function readPreferences(settings: unknown) {
  const raw =
    typeof settings === "object" && settings !== null
      ? (settings as Record<string, unknown>).preferences
      : undefined;
  const parsed = clientPreferencesSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : clientPreferencesSchema.parse({});
}

export type ListClientsOptions = {
  search?: string;
  status?: ClientStatus;
  /** Limit to one client (the dashboard's client switcher). */
  clientId?: string;
};

/** Every matching client, unpaged: for selectors and small lists. Use searchClients for the Clients page. */
export async function listClients(actor: Actor, options: ListClientsOptions = {}) {
  const db = options.clientId
    ? (await getClientContext(actor, options.clientId)).db
    : await getActorDb(actor);
  const search = options.search?.trim();
  return db.client.findMany({
    where: {
      ...(options.status ? { status: options.status } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { slug: { contains: search, mode: "insensitive" } },
              { websites: { some: { domain: { contains: search, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    include: { websites: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } },
    orderBy: { name: "asc" },
  });
}

export type SearchClientsOptions = {
  q?: string;
  status?: ClientStatus;
  /** "me" = clients I am the account owner of. */
  owner?: "me";
  /** Header selection. */
  clientId?: string;
  sort?: "name" | "recent";
  page?: number;
};

/** The Clients page: search, filters, paging, owner and a per-row "may archive" flag. */
export async function searchClients(actor: Actor, o: SearchClientsOptions = {}) {
  const db = o.clientId ? (await getClientContext(actor, o.clientId)).db : await getActorDb(actor);
  const page = clampPage(o.page);
  const q = o.q?.trim();
  const where: Prisma.ClientWhereInput = {
    ...(o.status ? { status: o.status } : {}),
    ...(o.owner === "me" ? { accountOwnerId: actor.userId } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { slug: { contains: q, mode: "insensitive" } },
            { industry: { contains: q, mode: "insensitive" } },
            { websites: { some: { domain: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
  const [rows, total, map] = await Promise.all([
    db.client.findMany({
      where,
      orderBy: o.sort === "recent" ? [{ updatedAt: "desc" }] : [{ name: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        websites: { where: { isPrimary: true }, take: 1 },
        accountOwner: { select: { id: true, name: true } },
        _count: { select: { projects: { where: { archivedAt: null, status: "active" } } } },
      },
    }),
    db.client.count({ where }),
    getAccessMap(actor),
  ]);
  return paged(
    rows.map((c) => ({
      ...c,
      canArchive: map.get(c.id)?.permissions.has("client.status") ?? false,
    })),
    total,
    page,
  );
}

export async function getClient(actor: Actor, clientId: string) {
  const ctx = await getClientContext(actor, clientId);
  const client = await ctx.db.client.findUnique({
    where: { id: clientId },
    include: {
      websites: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      accountOwner: { select: { id: true, name: true, email: true } },
    },
  });
  if (!client) throw new NotFoundError("Client not found");
  return { client, access: ctx.access, preferences: readPreferences(client.settings) };
}

export async function getOverviewStats(actor: Actor, clientId?: string) {
  const db = clientId ? (await getClientContext(actor, clientId)).db : await getActorDb(actor);
  const groups = await db.client.groupBy({ by: ["status"], _count: { _all: true } });
  const count = (status: ClientStatus) => groups.find((g) => g.status === status)?._count._all ?? 0;
  const active = count("active");
  const paused = count("paused");
  const archived = count("archived");
  return { total: active + paused + archived, active, paused, archived };
}

// ---- Ownership -------------------------------------------------------------------------------------

/**
 * May this user be a client's account owner? Same rule as the database trigger, checked first so the
 * form can show a friendly message: a platform admin, an active member of the client, or agency staff
 * with all-clients access. `clientId` is null while the client is being created.
 */
async function canOwn(tx: Tx, p: { agencyId: string; clientId: string | null; userId: string }) {
  const user = await tx.user.findUnique({
    where: { id: p.userId },
    select: { isAdmin: true, deactivatedAt: true },
  });
  if (!user || user.deactivatedAt) return false;
  if (user.isAdmin) return true;
  const seat = await tx.agencyMembership.findUnique({
    where: { agencyId_userId: { agencyId: p.agencyId, userId: p.userId } },
    select: { status: true, allClientsAccess: true },
  });
  if (seat?.status !== "active") return false;
  if (seat.allClientsAccess) return true;
  if (!p.clientId) return false;
  const member = await tx.clientMembership.findUnique({
    where: { userId_clientId: { userId: p.userId, clientId: p.clientId } },
    select: { status: true },
  });
  return member?.status === "active";
}

async function assertCanOwn(
  tx: Tx,
  p: { agencyId: string; clientId: string | null; userId: string },
) {
  if (!(await canOwn(tx, p))) {
    throw new ValidationError({ accountOwnerId: ["Choose someone who works on this client"] });
  }
}

/** Set or clear the account owner. Needs member.manage on the client. */
export async function setAccountOwner(actor: Actor, clientId: string, userId: string | null) {
  const ctx = await requirePermission(actor, clientId, "member.manage");
  const prisma = getUnscopedPrisma();
  return prisma.$transaction(async (tx) => {
    const before = await tx.client.findFirst({ where: { id: clientId, agencyId: ctx.agencyId } });
    if (!before) throw new NotFoundError("Client not found");
    if (userId) await assertCanOwn(tx, { agencyId: ctx.agencyId, clientId, userId });
    if (before.accountOwnerId === userId) return before;
    const after = await tx.client.update({
      where: { id: clientId },
      data: { accountOwnerId: userId },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId,
      action: "client.owner_changed",
      entityType: "client",
      entityId: clientId,
      before: { accountOwnerId: before.accountOwnerId },
      after: { accountOwnerId: after.accountOwnerId },
    });
    return after;
  });
}

// ---- Create / update -----------------------------------------------------------------------------------

/** Who may create clients: platform admins, and anyone holding client.create in an agency. */
export async function canCreateClients(actor: Actor): Promise<boolean> {
  return actor.isAdmin || (await listAgenciesWith(actor, "client.create")).length > 0;
}

/** The agency a new client goes into. Authorises the actor (client.create) for that agency. */
async function resolveCreatorAgency(actor: Actor, requested: string | undefined): Promise<string> {
  const prisma = getUnscopedPrisma();
  const allowed = actor.isAdmin
    ? await prisma.agency.findMany({ where: { status: "active" }, select: { id: true } })
    : await listAgenciesWith(actor, "client.create");
  if (allowed.length === 0) throw new ForbiddenError("You are not allowed to create clients");
  if (requested) {
    if (!allowed.some((a) => a.id === requested)) throw new NotFoundError("Agency not found");
    return requested;
  }
  if (allowed.length !== 1)
    throw new ValidationError({ agencyId: ["Choose an agency for this client"] });
  return allowed[0]!.id;
}

export async function createClient(actor: Actor, input: CreateClientInput) {
  const data = parseInput(createClientSchema, input);
  const agencyId = await resolveCreatorAgency(actor, data.agencyId);
  const prisma = getUnscopedPrisma();
  const baseSlug = data.slug ?? slugify(data.name);

  // The creator owns the new client by default, if they are someone who can.
  let ownerId = data.accountOwnerId ?? null;
  if (ownerId) await assertCanOwn(prisma, { agencyId, clientId: null, userId: ownerId });
  else if (await canOwn(prisma, { agencyId, clientId: null, userId: actor.userId }))
    ownerId = actor.userId;

  // Auto-generated slugs get a numeric suffix on collision; explicit ones are a conflict.
  for (let attempt = 0; attempt < 20; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`.slice(0, 60);
    try {
      return await prisma.$transaction(async (tx) => {
        const client = await tx.client.create({
          data: {
            agencyId,
            name: data.name,
            slug,
            industry: data.industry ?? null,
            goals: data.goals ?? null,
            targetLocations: data.targetLocations,
            timezone: data.timezone,
            locale: data.locale,
            reportEmail: data.reportEmail ?? null,
            reportIntervalDays: data.reportIntervalDays,
            accountOwnerId: ownerId,
            settings: { preferences: data.preferences },
          },
        });
        if (data.primaryDomain) {
          await tx.website.create({
            data: { agencyId, clientId: client.id, domain: data.primaryDomain, isPrimary: true },
          });
        }
        await recordAudit(tx, {
          actorUserId: actor.userId,
          agencyId,
          clientId: client.id,
          action: "client.created",
          entityType: "client",
          entityId: client.id,
          after: { ...snapshot(client), primaryDomain: data.primaryDomain ?? null },
        });
        return client;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      if (data.slug) throw new ConflictError(`The slug "${slug}" is already in use`);
    }
  }
  throw new ConflictError("Could not generate a unique slug; enter one manually");
}

export async function updateClient(actor: Actor, clientId: string, input: UpdateClientInput) {
  const ctx = await requirePermission(actor, clientId, "client.update");
  const data = parseInput(updateClientSchema, input);
  try {
    return await ctx.db.$transaction(async (tx) => {
      const before = await tx.client.findUnique({ where: { id: clientId } });
      if (!before) throw new NotFoundError("Client not found");
      const settings =
        typeof before.settings === "object" && before.settings !== null ? before.settings : {};
      const after = await tx.client.update({
        where: { id: clientId },
        data: {
          name: data.name,
          slug: data.slug,
          industry: data.industry ?? null,
          goals: data.goals ?? null,
          targetLocations: data.targetLocations,
          timezone: data.timezone,
          locale: data.locale,
          reportEmail: data.reportEmail ?? null,
          reportIntervalDays: data.reportIntervalDays,
          settings: { ...(settings as object), preferences: data.preferences },
        },
      });
      await recordAudit(tx, {
        actorUserId: actor.userId,
        clientId,
        action: "client.updated",
        entityType: "client",
        entityId: clientId,
        before: { ...snapshot(before), preferences: readPreferences(before.settings) },
        after: { ...snapshot(after), preferences: data.preferences },
      });
      return after;
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new ConflictError(`The slug "${data.slug}" is already in use`);
    throw error;
  }
}

export async function setClientStatus(actor: Actor, clientId: string, status: ClientStatus) {
  const ctx = await requirePermission(actor, clientId, "client.status");
  const next = parseInput(clientStatusSchema, status);
  return ctx.db.$transaction(async (tx) => {
    const before = await tx.client.findUnique({ where: { id: clientId } });
    if (!before) throw new NotFoundError("Client not found");
    if (before.status === next) return before;
    const after = await tx.client.update({
      where: { id: clientId },
      data: { status: next, archivedAt: next === "archived" ? new Date() : null },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      clientId,
      action: "client.status_changed",
      entityType: "client",
      entityId: clientId,
      before: { status: before.status },
      after: { status: after.status },
    });
    return after;
  });
}

// ---- Summary for the client page ------------------------------------------------------------------------

/**
 * Everything on a client's overview tab. Each block is included only if the actor holds the permission
 * for it, and users whose only role is Client see only the projects they were added to.
 */
export async function getClientSummary(actor: Actor, clientId: string) {
  const ctx = await getClientContext(actor, clientId);
  const { db, access } = ctx;
  const can = (p: Parameters<typeof access.permissions.has>[0]) => access.permissions.has(p);

  let projectIds: string[] | undefined;
  if (isClientRoleOnly(access)) {
    const memberships = await db.projectMembership.findMany({
      where: { userId: actor.userId },
      select: { projectId: true },
    });
    projectIds = memberships.map((m) => m.projectId);
  }
  const projectWhere: Prisma.ProjectWhereInput = {
    archivedAt: null,
    status: { in: ["active", "paused"] },
    ...(projectIds ? { id: { in: projectIds } } : {}),
  };
  const taskWhere: Prisma.TaskWhereInput = {
    archivedAt: null,
    status: { notIn: ["completed", "cancelled"] },
    ...(projectIds ? { projectId: { in: projectIds } } : {}),
  };
  const weekAhead = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const [projects, openTasks, dueSoon, overdue, reports, accounts, syncs, activity] =
    await Promise.all([
      db.project.findMany({
        where: projectWhere,
        orderBy: { updatedAt: "desc" },
        take: 6,
        include: { _count: { select: { projectMemberships: true } } },
      }),
      can("task.view") ? db.task.count({ where: taskWhere }) : Promise.resolve(null),
      can("task.view")
        ? db.task.count({ where: { ...taskWhere, dueAt: { gte: new Date(), lte: weekAhead } } })
        : Promise.resolve(null),
      can("task.view")
        ? db.task.count({ where: { ...taskWhere, dueAt: { lt: new Date() } } })
        : Promise.resolve(null),
      can("report.view")
        ? db.report.findMany({
            orderBy: { periodEnd: "desc" },
            take: 5,
            select: { id: true, title: true, status: true, periodStart: true, periodEnd: true },
          })
        : Promise.resolve(null),
      // Status only: credentials are never selected.
      db.integrationAccount.findMany({
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          status: true,
          displayName: true,
          lastSyncedAt: true,
          lastErrorAt: true,
          integration: { select: { name: true, category: true } },
        },
      }),
      db.syncRun.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          integrationAccountId: true,
          status: true,
          createdAt: true,
          finishedAt: true,
          rowsWritten: true,
          kind: true,
        },
      }),
      db.auditLog.findMany({
        where: { NOT: { action: { startsWith: "auth" } } },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { actor: { select: { name: true } } },
      }),
    ]);

  // Latest sync per connected account.
  const latestByAccount = new Map<string, (typeof syncs)[number]>();
  for (const run of syncs)
    if (!latestByAccount.has(run.integrationAccountId))
      latestByAccount.set(run.integrationAccountId, run);
  return {
    projects,
    tasks:
      openTasks === null ? null : { open: openTasks, dueSoon: dueSoon ?? 0, overdue: overdue ?? 0 },
    reports,
    integrations: accounts.map((a) => ({ ...a, latestSync: latestByAccount.get(a.id) ?? null })),
    activity,
    access,
  };
}

export async function addWebsite(actor: Actor, clientId: string, input: AddWebsiteInput) {
  const ctx = await requirePermission(actor, clientId, "website.manage");
  const data = parseInput(addWebsiteSchema, input);
  try {
    return await ctx.db.$transaction(async (tx) => {
      const existing = await tx.website.count();
      const isPrimary = data.isPrimary || existing === 0;
      if (isPrimary)
        await tx.website.updateMany({ where: { isPrimary: true }, data: { isPrimary: false } });
      const website = await tx.website.create({
        data: { agencyId: ctx.agencyId, clientId, domain: data.domain, isPrimary },
      });
      await recordAudit(tx, {
        actorUserId: actor.userId,
        clientId,
        action: "website.added",
        entityType: "website",
        entityId: website.id,
        after: { domain: website.domain, isPrimary: website.isPrimary },
      });
      return website;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`${data.domain} is already added`);
    throw error;
  }
}

export async function removeWebsite(actor: Actor, clientId: string, websiteId: string) {
  const ctx = await requirePermission(actor, clientId, "website.manage");
  await ctx.db.$transaction(async (tx) => {
    const website = await tx.website.findUnique({ where: { id: websiteId } });
    if (!website) throw new NotFoundError("Website not found");
    await tx.website.delete({ where: { id: websiteId } });
    if (website.isPrimary) {
      const next = await tx.website.findFirst({ orderBy: { createdAt: "asc" } });
      if (next) await tx.website.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    await recordAudit(tx, {
      actorUserId: actor.userId,
      clientId,
      action: "website.removed",
      entityType: "website",
      entityId: websiteId,
      before: { domain: website.domain, isPrimary: website.isPrimary },
    });
  });
}

export async function listAuditLog(actor: Actor, clientId: string, limit = 10) {
  const ctx = await getClientContext(actor, clientId);
  return ctx.db.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { actor: { select: { name: true, email: true } } },
  });
}
