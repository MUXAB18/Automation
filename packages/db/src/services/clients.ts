import { forAdmin, getActorDb, getClientContext, requirePermission, type Actor } from "../access";
import { recordAudit } from "../audit";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import type { ClientStatus } from "../generated/enums";
import { canCreateClient } from "../permissions";
import {
  addWebsiteSchema,
  createClientSchema,
  clientStatusSchema,
  parseInput,
  slugify,
  updateClientSchema,
  type AddWebsiteInput,
  type CreateClientInput,
  type UpdateClientInput,
} from "../schemas";

const isUniqueViolation = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";

const snapshot = (c: {
  name: string;
  slug: string;
  status: string;
  reportEmail: string | null;
  reportIntervalDays: number;
}) => ({
  name: c.name,
  slug: c.slug,
  status: c.status,
  reportEmail: c.reportEmail,
  reportIntervalDays: c.reportIntervalDays,
});

export type ListClientsOptions = {
  search?: string;
  status?: ClientStatus;
  /** Limit to one client (the dashboard's client switcher). */
  clientId?: string;
};

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

export async function getClient(actor: Actor, clientId: string) {
  const ctx = await getClientContext(actor, clientId);
  const client = await ctx.db.client.findUnique({
    where: { id: clientId },
    include: { websites: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } },
  });
  if (!client) throw new NotFoundError("Client not found");
  return { client, access: ctx.access };
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

export async function createClient(actor: Actor, input: CreateClientInput) {
  if (!canCreateClient(actor)) throw new ForbiddenError("Only admins can create clients");
  const data = parseInput(createClientSchema, input);
  const db = forAdmin(actor);
  const baseSlug = data.slug ?? slugify(data.name);

  // Auto-generated slugs get a numeric suffix on collision; explicit ones are a conflict.
  for (let attempt = 0; attempt < 20; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`.slice(0, 60);
    try {
      return await db.$transaction(async (tx) => {
        const client = await tx.client.create({
          data: {
            name: data.name,
            slug,
            reportEmail: data.reportEmail ?? null,
            reportIntervalDays: data.reportIntervalDays,
          },
        });
        if (data.primaryDomain) {
          await tx.website.create({
            data: { clientId: client.id, domain: data.primaryDomain, isPrimary: true },
          });
        }
        await recordAudit(tx, {
          actorUserId: actor.userId,
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
      const after = await tx.client.update({
        where: { id: clientId },
        data: {
          name: data.name,
          slug: data.slug,
          reportEmail: data.reportEmail ?? null,
          reportIntervalDays: data.reportIntervalDays,
        },
      });
      await recordAudit(tx, {
        actorUserId: actor.userId,
        clientId,
        action: "client.updated",
        entityType: "client",
        entityId: clientId,
        before: snapshot(before),
        after: snapshot(after),
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
    const after = await tx.client.update({ where: { id: clientId }, data: { status: next } });
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
        data: { clientId, domain: data.domain, isPrimary },
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
