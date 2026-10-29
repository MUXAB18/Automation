import { ForbiddenError, NotFoundError } from "./errors";
import { can, type Access, type Permission } from "./permissions";
import { createScopedClient, type Scope, type ScopedDb } from "./scope";
import { getUnscopedPrisma } from "./unsafe";

/** The signed-in user, as the data layer needs to see them. */
export type Actor = { userId: string; isAdmin: boolean };

const scoped = (scope: Scope): ScopedDb => createScopedClient(getUnscopedPrisma(), scope);

export const forCustomer = (customerId: string): ScopedDb => scoped({ customerIds: [customerId] });
export const forCustomers = (customerIds: readonly string[]): ScopedDb => scoped({ customerIds });

/** Unscoped access for platform admins only. */
export function forAdmin(actor: Pick<Actor, "isAdmin">): ScopedDb {
  if (!actor.isAdmin) throw new ForbiddenError("Admin access required");
  return scoped({ all: true });
}

/** Unscoped access for background jobs that loop over all customers (worker only). */
export const forSystem = (): ScopedDb => scoped({ all: true });

/** A client limited to the customers this actor may see. */
export async function getActorDb(actor: Actor): Promise<ScopedDb> {
  if (actor.isAdmin) return forAdmin(actor);
  const memberships = await getUnscopedPrisma().membership.findMany({
    where: { userId: actor.userId },
    select: { customerId: true },
  });
  return forCustomers(memberships.map((m) => m.customerId));
}

export type CustomerContext = { db: ScopedDb; access: Access; customerId: string };

/** Resolve the actor's access to one customer. Throws NotFoundError if they have none. */
export async function getCustomerContext(actor: Actor, customerId: string): Promise<CustomerContext> {
  const db = forCustomer(customerId);
  if (actor.isAdmin) {
    const exists = await db.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!exists) throw new NotFoundError("Customer not found");
    return { db, customerId, access: { role: "admin", isPlatformAdmin: true } };
  }
  const membership = await getUnscopedPrisma().membership.findUnique({
    where: { userId_customerId: { userId: actor.userId, customerId } },
    select: { role: true },
  });
  if (!membership) throw new NotFoundError("Customer not found");
  return { db, customerId, access: { role: membership.role, isPlatformAdmin: false } };
}

export async function requirePermission(
  actor: Actor,
  customerId: string,
  permission: Permission,
): Promise<CustomerContext> {
  const ctx = await getCustomerContext(actor, customerId);
  if (!can(ctx.access, permission)) throw new ForbiddenError();
  return ctx;
}
