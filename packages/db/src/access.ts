import { recordSecurityEvent } from "./audit";
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

type RoleRow = {
  role: { key: string; rolePermissions: { permission: { key: string } }[] };
};

const ROLES_SELECT = {
  select: {
    role: {
      select: { key: true, rolePermissions: { select: { permission: { select: { key: true } } } } },
    },
  },
} as const;

/** Permissions that only make sense at agency level; never granted by a per-client role. */
const AGENCY_ONLY = (p: string) => p.startsWith("agency.") || p === "client.create";

function collect(rows: RoleRow[], into: Set<Permission>, roles: Set<string>, clientLevel: boolean) {
  for (const { role } of rows) {
    roles.add(role.key);
    for (const rp of role.rolePermissions) {
      if (clientLevel && AGENCY_ONLY(rp.permission.key)) continue;
      into.add(rp.permission.key as Permission);
    }
  }
}

/** Ids of every client this actor can reach: direct memberships plus agency-wide access. */
export async function listAccessibleClientIds(actor: Actor): Promise<string[]> {
  const prisma = getUnscopedPrisma();
  const seatIsActive = {
    userId: actor.userId,
    status: "active",
    user: { deactivatedAt: null },
  } as const;
  const [direct, viaAgency] = await Promise.all([
    prisma.clientMembership.findMany({
      where: { userId: actor.userId, status: "active", agencyMembership: seatIsActive },
      select: { clientId: true },
    }),
    prisma.client.findMany({
      where: {
        agency: { agencyMemberships: { some: { ...seatIsActive, allClientsAccess: true } } },
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

/** Record a refused access attempt (best effort). `kind` separates "no access" from "not allowed". */
async function denied(
  actor: Actor,
  target: { agencyId?: string; clientId?: string },
  kind: "no_access" | "forbidden",
  permission?: Permission,
) {
  await recordSecurityEvent({
    action: kind === "no_access" ? "authz.access_denied" : "authz.permission_denied",
    actorUserId: actor.userId,
    agencyId: target.agencyId,
    clientId: target.clientId,
    entityType: target.clientId ? "client" : "agency",
    entityId: target.clientId ?? target.agencyId ?? "unknown",
    details: permission ? { permission } : undefined,
  });
}

/**
 * Resolve the actor's access to one client. Throws NotFoundError (never "forbidden") when they have
 * no access at all, so a guessed id does not reveal whether the client exists.
 */
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

  const [user, membership, agencyMembership] = await Promise.all([
    prisma.user.findUnique({ where: { id: actor.userId }, select: { deactivatedAt: true } }),
    prisma.clientMembership.findUnique({
      where: { userId_clientId: { userId: actor.userId, clientId } },
      select: { status: true, roles: ROLES_SELECT },
    }),
    prisma.agencyMembership.findUnique({
      where: { agencyId_userId: { agencyId: client.agencyId, userId: actor.userId } },
      select: { status: true, allClientsAccess: true, roles: ROLES_SELECT },
    }),
  ]);

  const permissions = new Set<Permission>();
  const roles = new Set<string>();
  // Both the user and their seat in the agency must be active for anything to apply.
  if (user && !user.deactivatedAt && agencyMembership?.status === "active") {
    if (membership?.status === "active") collect(membership.roles, permissions, roles, true);
    if (agencyMembership.allClientsAccess)
      collect(agencyMembership.roles, permissions, roles, false);
  }
  if (roles.size === 0) {
    await denied(actor, { agencyId: client.agencyId, clientId }, "no_access");
    throw new NotFoundError("Client not found");
  }
  return {
    db,
    clientId,
    agencyId: client.agencyId,
    access: { permissions, roles: [...roles], isPlatformAdmin: false },
  };
}

export async function requirePermission(
  actor: Actor,
  clientId: string,
  permission: Permission,
): Promise<ClientContext> {
  const ctx = await getClientContext(actor, clientId);
  if (!can(ctx.access, permission)) {
    await denied(actor, { agencyId: ctx.agencyId, clientId }, "forbidden", permission);
    throw new ForbiddenError();
  }
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
  const prisma = getUnscopedPrisma();
  const [user, membership] = await Promise.all([
    prisma.user.findUnique({ where: { id: actor.userId }, select: { deactivatedAt: true } }),
    prisma.agencyMembership.findUnique({
      where: { agencyId_userId: { agencyId, userId: actor.userId } },
      select: { status: true, roles: ROLES_SELECT },
    }),
  ]);
  const permissions = new Set<Permission>();
  const roles = new Set<string>();
  if (user && !user.deactivatedAt && membership?.status === "active") {
    collect(membership.roles, permissions, roles, false);
  }
  if (roles.size === 0) {
    await denied(actor, { agencyId }, "no_access");
    throw new NotFoundError("Agency not found");
  }
  const access: Access = { permissions, roles: [...roles], isPlatformAdmin: false };
  if (!can(access, permission)) {
    await denied(actor, { agencyId }, "forbidden", permission);
    throw new ForbiddenError();
  }
  return access;
}

/** Agencies where the actor holds a permission (for agency-level screens such as Team). */
export async function listAgenciesWith(
  actor: Actor,
  permission: Permission,
): Promise<{ id: string; name: string }[]> {
  const prisma = getUnscopedPrisma();
  if (actor.isAdmin) {
    return prisma.agency.findMany({
      where: { status: "active" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }
  return prisma.agency.findMany({
    where: {
      status: "active",
      agencyMemberships: {
        some: {
          userId: actor.userId,
          status: "active",
          user: { deactivatedAt: null },
          roles: {
            some: { role: { rolePermissions: { some: { permission: { key: permission } } } } },
          },
        },
      },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** What an actor may do on each client they can reach. Built from the same rules as getClientContext. */
export type AccessMap = Map<
  string,
  { permissions: ReadonlySet<Permission>; roles: ReadonlySet<string> }
>;

/**
 * Effective permissions on every client the actor can reach, in two queries. Section pages (Tasks, SEO, ...)
 * use this to decide which clients each list may include: a client where the user lacks the section's
 * permission contributes nothing, even though they can see the client itself.
 */
export async function getAccessMap(actor: Actor): Promise<AccessMap> {
  const prisma = getUnscopedPrisma();
  const map: AccessMap = new Map();

  if (actor.isAdmin) {
    const clients = await prisma.client.findMany({ select: { id: true } });
    for (const c of clients)
      map.set(c.id, { permissions: ALL_PERMISSIONS, roles: new Set(["platform_admin"]) });
    return map;
  }

  const seatIsActive = {
    userId: actor.userId,
    status: "active",
    user: { deactivatedAt: null },
  } as const;
  const [clientSeats, agencySeats] = await Promise.all([
    prisma.clientMembership.findMany({
      where: { userId: actor.userId, status: "active", agencyMembership: seatIsActive },
      select: { clientId: true, roles: ROLES_SELECT },
    }),
    prisma.agencyMembership.findMany({
      where: { ...seatIsActive, allClientsAccess: true },
      select: { roles: ROLES_SELECT, agency: { select: { clients: { select: { id: true } } } } },
    }),
  ]);

  const add = (clientId: string, rows: RoleRow[], clientLevel: boolean) => {
    const entry = map.get(clientId) ?? {
      permissions: new Set<Permission>(),
      roles: new Set<string>(),
    };
    collect(rows, entry.permissions as Set<Permission>, entry.roles as Set<string>, clientLevel);
    map.set(clientId, entry);
  };
  for (const seat of clientSeats) add(seat.clientId, seat.roles, true);
  for (const seat of agencySeats) for (const c of seat.agency.clients) add(c.id, seat.roles, false);
  for (const [id, entry] of map) if (entry.roles.size === 0) map.delete(id);
  return map;
}

/** Client ids on which the actor holds a permission. */
export function clientIdsWith(map: AccessMap, permission: Permission): string[] {
  return [...map].filter(([, e]) => e.permissions.has(permission)).map(([id]) => id);
}

/**
 * What ANOTHER user may do on a client (for validating assignees and finding reviewers). Same rules as
 * getClientContext but never throws or logs: returns null when they have no access at all.
 */
export async function resolveUserAccess(
  userId: string,
  clientId: string,
  agencyId: string,
): Promise<Access | null> {
  const prisma = getUnscopedPrisma();
  const [user, membership, agencyMembership] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { deactivatedAt: true, isAdmin: true },
    }),
    prisma.clientMembership.findUnique({
      where: { userId_clientId: { userId, clientId } },
      select: { status: true, roles: ROLES_SELECT },
    }),
    prisma.agencyMembership.findUnique({
      where: { agencyId_userId: { agencyId, userId } },
      select: { status: true, allClientsAccess: true, roles: ROLES_SELECT },
    }),
  ]);
  if (!user || user.deactivatedAt) return null;
  if (user.isAdmin)
    return { permissions: ALL_PERMISSIONS, roles: ["platform_admin"], isPlatformAdmin: true };
  const permissions = new Set<Permission>();
  const roles = new Set<string>();
  if (agencyMembership?.status === "active") {
    if (membership?.status === "active") collect(membership.roles, permissions, roles, true);
    if (agencyMembership.allClientsAccess)
      collect(agencyMembership.roles, permissions, roles, false);
  }
  return roles.size === 0 ? null : { permissions, roles: [...roles], isPlatformAdmin: false };
}

/** Active people (not platform admins) who hold a permission on a client, e.g. everyone who can review tasks. */
export async function listUsersWithPermission(
  agencyId: string,
  clientId: string,
  permission: Permission,
): Promise<string[]> {
  const prisma = getUnscopedPrisma();
  const hasPermission = {
    some: { role: { rolePermissions: { some: { permission: { key: permission } } } } },
  };
  const activeUser = { deactivatedAt: null };
  const [direct, wide] = await Promise.all([
    prisma.clientMembership.findMany({
      where: {
        clientId,
        status: "active",
        roles: hasPermission,
        agencyMembership: { status: "active", user: activeUser },
      },
      select: { userId: true },
    }),
    permission.startsWith("agency.") || permission === "client.create"
      ? Promise.resolve([])
      : prisma.agencyMembership.findMany({
          where: {
            agencyId,
            status: "active",
            allClientsAccess: true,
            roles: hasPermission,
            user: activeUser,
          },
          select: { userId: true },
        }),
  ]);
  return [...new Set([...direct, ...wide].map((m) => m.userId))];
}
