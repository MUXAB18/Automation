import { ForbiddenError, NotFoundError } from "./errors";
import { ALL_PERMISSIONS, can, type Access, type Permission } from "./permissions";
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

const permissionsOf = (role: { rolePermissions: { permission: { key: string } }[] }) =>
  role.rolePermissions.map((rp) => rp.permission.key as Permission);

const ROLE_WITH_PERMISSIONS = {
  select: { key: true, rolePermissions: { select: { permission: { select: { key: true } } } } },
} as const;

/** Ids of every client this actor can reach: direct memberships plus agency-wide access. */
export async function listAccessibleClientIds(actor: Actor): Promise<string[]> {
  const prisma = getUnscopedPrisma();
  const [direct, viaAgency] = await Promise.all([
    prisma.clientMembership.findMany({
      where: { userId: actor.userId, status: "active" },
      select: { clientId: true },
    }),
    prisma.client.findMany({
      where: {
        agency: {
          agencyMemberships: {
            some: { userId: actor.userId, status: "active", allClientsAccess: true },
          },
        },
      },
      select: { id: true },
    }),
  ]);
  return [...new Set([...direct.map((m) => m.clientId), ...viaAgency.map((c) => c.id)])];
}

/** A client limited to the clients this actor may see. */
export async function getActorDb(actor: Actor): Promise<ScopedDb> {
  if (actor.isAdmin) return forAdmin(actor);
  return forClients(await listAccessibleClientIds(actor));
}

export type ClientContext = { db: ScopedDb; access: Access; clientId: string; agencyId: string };

/** Resolve the actor's access to one client. Throws NotFoundError if they have none. */
export async function getClientContext(actor: Actor, clientId: string): Promise<ClientContext> {
  const prisma = getUnscopedPrisma();
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, agencyId: true },
  });
  if (!client) throw new NotFoundError("Client not found");
  const db = forClient(clientId);

  if (actor.isAdmin) {
    return {
      db,
      clientId,
      agencyId: client.agencyId,
      access: { permissions: ALL_PERMISSIONS, roles: ["platform_admin"], isPlatformAdmin: true },
    };
  }

  const [membership, agencyMembership] = await Promise.all([
    prisma.clientMembership.findUnique({
      where: { userId_clientId: { userId: actor.userId, clientId } },
      select: { status: true, role: ROLE_WITH_PERMISSIONS },
    }),
    prisma.agencyMembership.findUnique({
      where: { agencyId_userId: { agencyId: client.agencyId, userId: actor.userId } },
      select: { status: true, allClientsAccess: true, role: ROLE_WITH_PERMISSIONS },
    }),
  ]);

  const permissions = new Set<Permission>();
  const roles: string[] = [];
  if (membership?.status === "active") {
    permissionsOf(membership.role).forEach((p) => permissions.add(p));
    roles.push(membership.role.key);
  }
  if (agencyMembership?.status === "active" && agencyMembership.allClientsAccess) {
    permissionsOf(agencyMembership.role).forEach((p) => permissions.add(p));
    roles.push(`agency:${agencyMembership.role.key}`);
  }
  if (roles.length === 0) throw new NotFoundError("Client not found");
  return {
    db,
    clientId,
    agencyId: client.agencyId,
    access: { permissions, roles, isPlatformAdmin: false },
  };
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

/** Authorise an agency-level action (staff, roles, templates). Not-a-member is "not found". */
export async function requireAgencyPermission(
  actor: Actor,
  agencyId: string,
  permission: Permission,
): Promise<Access> {
  if (actor.isAdmin) {
    return { permissions: ALL_PERMISSIONS, roles: ["platform_admin"], isPlatformAdmin: true };
  }
  const membership = await getUnscopedPrisma().agencyMembership.findUnique({
    where: { agencyId_userId: { agencyId, userId: actor.userId } },
    select: { status: true, role: ROLE_WITH_PERMISSIONS },
  });
  if (membership?.status !== "active") throw new NotFoundError("Agency not found");
  const access: Access = {
    permissions: new Set(permissionsOf(membership.role)),
    roles: [membership.role.key],
    isPlatformAdmin: false,
  };
  if (!can(access, permission)) throw new ForbiddenError();
  return access;
}
