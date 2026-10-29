import { ForbiddenError, NotFoundError } from "./errors";
import { can, type Access, type Permission } from "./permissions";
import { createScopedClient, type Scope, type ScopedDb } from "./scope";
import { getUnscopedPrisma } from "./unsafe";

/** The signed-in user, as the data layer needs to see them. */
export type Actor = { userId: string; isAdmin: boolean };

const scoped = (scope: Scope): ScopedDb => createScopedClient(getUnscopedPrisma(), scope);

export const forClient = (clientId: string): ScopedDb => scoped({ clientIds: [clientId] });
export const forClients = (clientIds: readonly string[]): ScopedDb => scoped({ clientIds });

/** Unscoped access for platform admins only. */
export function forAdmin(actor: Pick<Actor, "isAdmin">): ScopedDb {
  if (!actor.isAdmin) throw new ForbiddenError("Admin access required");
  return scoped({ all: true });
}

/** Unscoped access for background jobs that loop over all clients (worker only). */
export const forSystem = (): ScopedDb => scoped({ all: true });

/** A client limited to the clients this actor may see. */
export async function getActorDb(actor: Actor): Promise<ScopedDb> {
  if (actor.isAdmin) return forAdmin(actor);
  const memberships = await getUnscopedPrisma().membership.findMany({
    where: { userId: actor.userId },
    select: { clientId: true },
  });
  return forClients(memberships.map((m) => m.clientId));
}

export type ClientContext = { db: ScopedDb; access: Access; clientId: string };

/** Resolve the actor's access to one client. Throws NotFoundError if they have none. */
export async function getClientContext(actor: Actor, clientId: string): Promise<ClientContext> {
  const db = forClient(clientId);
  if (actor.isAdmin) {
    const exists = await db.client.findUnique({ where: { id: clientId }, select: { id: true } });
    if (!exists) throw new NotFoundError("Client not found");
    return { db, clientId, access: { role: "admin", isPlatformAdmin: true } };
  }
  const membership = await getUnscopedPrisma().membership.findUnique({
    where: { userId_clientId: { userId: actor.userId, clientId } },
    select: { role: true },
  });
  if (!membership) throw new NotFoundError("Client not found");
  return { db, clientId, access: { role: membership.role, isPlatformAdmin: false } };
}

export async function requirePermission(
  actor: Actor,
  clientId: string,
  permission: Permission,
): Promise<ClientContext> {
  const ctx = await getClientContext(actor, clientId);
  if (!can(ctx.access, permission)) throw new ForbiddenError();
  return ctx;
}
