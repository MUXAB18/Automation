import { forAdmin, getActorDb, getCustomerContext, requirePermission, type Actor } from "../access";
import { recordAudit } from "../audit";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import type { CustomerStatus } from "../generated/enums";
import { canCreateCustomer } from "../permissions";
import {
  addWebsiteSchema,
  createCustomerSchema,
  customerStatusSchema,
  parseInput,
  slugify,
  updateCustomerSchema,
  type AddWebsiteInput,
  type CreateCustomerInput,
  type UpdateCustomerInput,
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

export type ListCustomersOptions = {
  search?: string;
  status?: CustomerStatus;
  /** Limit to one customer (the dashboard's customer switcher). */
  customerId?: string;
};

export async function listCustomers(actor: Actor, options: ListCustomersOptions = {}) {
  const db = options.customerId
    ? (await getCustomerContext(actor, options.customerId)).db
    : await getActorDb(actor);
  const search = options.search?.trim();
  return db.customer.findMany({
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

export async function getCustomer(actor: Actor, customerId: string) {
  const ctx = await getCustomerContext(actor, customerId);
  const customer = await ctx.db.customer.findUnique({
    where: { id: customerId },
    include: { websites: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } },
  });
  if (!customer) throw new NotFoundError("Customer not found");
  return { customer, access: ctx.access };
}

export async function getOverviewStats(actor: Actor, customerId?: string) {
  const db = customerId ? (await getCustomerContext(actor, customerId)).db : await getActorDb(actor);
  const groups = await db.customer.groupBy({ by: ["status"], _count: { _all: true } });
  const count = (status: CustomerStatus) => groups.find((g) => g.status === status)?._count._all ?? 0;
  const active = count("active");
  const paused = count("paused");
  const archived = count("archived");
  return { total: active + paused + archived, active, paused, archived };
}

export async function createCustomer(actor: Actor, input: CreateCustomerInput) {
  if (!canCreateCustomer(actor)) throw new ForbiddenError("Only admins can create customers");
  const data = parseInput(createCustomerSchema, input);
  const db = forAdmin(actor);
  const baseSlug = data.slug ?? slugify(data.name);

  // Auto-generated slugs get a numeric suffix on collision; explicit ones are a conflict.
  for (let attempt = 0; attempt < 20; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`.slice(0, 60);
    try {
      return await db.$transaction(async (tx) => {
        const customer = await tx.customer.create({
          data: {
            name: data.name,
            slug,
            reportEmail: data.reportEmail ?? null,
            reportIntervalDays: data.reportIntervalDays,
          },
        });
        if (data.primaryDomain) {
          await tx.website.create({
            data: { customerId: customer.id, domain: data.primaryDomain, isPrimary: true },
          });
        }
        await recordAudit(tx, {
          actorUserId: actor.userId,
          customerId: customer.id,
          action: "customer.created",
          entityType: "customer",
          entityId: customer.id,
          after: { ...snapshot(customer), primaryDomain: data.primaryDomain ?? null },
        });
        return customer;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      if (data.slug) throw new ConflictError(`The slug "${slug}" is already in use`);
    }
  }
  throw new ConflictError("Could not generate a unique slug; enter one manually");
}

export async function updateCustomer(actor: Actor, customerId: string, input: UpdateCustomerInput) {
  const ctx = await requirePermission(actor, customerId, "customer.update");
  const data = parseInput(updateCustomerSchema, input);
  try {
    return await ctx.db.$transaction(async (tx) => {
      const before = await tx.customer.findUnique({ where: { id: customerId } });
      if (!before) throw new NotFoundError("Customer not found");
      const after = await tx.customer.update({
        where: { id: customerId },
        data: {
          name: data.name,
          slug: data.slug,
          reportEmail: data.reportEmail ?? null,
          reportIntervalDays: data.reportIntervalDays,
        },
      });
      await recordAudit(tx, {
        actorUserId: actor.userId,
        customerId,
        action: "customer.updated",
        entityType: "customer",
        entityId: customerId,
        before: snapshot(before),
        after: snapshot(after),
      });
      return after;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`The slug "${data.slug}" is already in use`);
    throw error;
  }
}

export async function setCustomerStatus(actor: Actor, customerId: string, status: CustomerStatus) {
  const ctx = await requirePermission(actor, customerId, "customer.status");
  const next = parseInput(customerStatusSchema, status);
  return ctx.db.$transaction(async (tx) => {
    const before = await tx.customer.findUnique({ where: { id: customerId } });
    if (!before) throw new NotFoundError("Customer not found");
    if (before.status === next) return before;
    const after = await tx.customer.update({ where: { id: customerId }, data: { status: next } });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      customerId,
      action: "customer.status_changed",
      entityType: "customer",
      entityId: customerId,
      before: { status: before.status },
      after: { status: after.status },
    });
    return after;
  });
}

export async function addWebsite(actor: Actor, customerId: string, input: AddWebsiteInput) {
  const ctx = await requirePermission(actor, customerId, "website.manage");
  const data = parseInput(addWebsiteSchema, input);
  try {
    return await ctx.db.$transaction(async (tx) => {
      const existing = await tx.website.count();
      const isPrimary = data.isPrimary || existing === 0;
      if (isPrimary) await tx.website.updateMany({ where: { isPrimary: true }, data: { isPrimary: false } });
      const website = await tx.website.create({
        data: { customerId, domain: data.domain, isPrimary },
      });
      await recordAudit(tx, {
        actorUserId: actor.userId,
        customerId,
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

export async function removeWebsite(actor: Actor, customerId: string, websiteId: string) {
  const ctx = await requirePermission(actor, customerId, "website.manage");
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
      customerId,
      action: "website.removed",
      entityType: "website",
      entityId: websiteId,
      before: { domain: website.domain, isPrimary: website.isPrimary },
    });
  });
}

export async function listAuditLog(actor: Actor, customerId: string, limit = 10) {
  const ctx = await getCustomerContext(actor, customerId);
  return ctx.db.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { actor: { select: { name: true, email: true } } },
  });
}
