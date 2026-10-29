import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { requireAgencyPermission, requirePermission, type Actor } from "../access";
import { recordAudit } from "../audit";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import type { Prisma } from "../generated/client";
import type { Access } from "../permissions";
import { ROLE_KEYS, type RoleKey } from "../rbac";
import { parseInput } from "../schemas";
import { getUnscopedPrisma } from "../unsafe";

/**
 * Team management: invitations, role assignment and removal. Every function authorises the actor
 * first (agency.members for agency-level changes, member.manage for one client) and writes audit_log
 * in the same transaction as the change.
 */

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const roleKeysSchema = z.array(z.enum(ROLE_KEYS)).min(1, "Choose at least one role");

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

type Tx = Prisma.TransactionClient;
const prismaClient = () => getUnscopedPrisma();

// ---- Helpers ---------------------------------------------------------------------------------

type RoleWithPerms = { id: string; key: string; scope: string; permissions: string[] };

async function loadRoles(
  db: Tx,
  agencyId: string,
  keys: readonly string[],
): Promise<RoleWithPerms[]> {
  const rows = await db.role.findMany({
    where: { agencyId, key: { in: [...keys] } },
    select: {
      id: true,
      key: true,
      scope: true,
      rolePermissions: { select: { permission: { select: { key: true } } } },
    },
  });
  if (rows.length !== new Set(keys).size) {
    throw new ValidationError({ roleKeys: ["One of the roles does not exist in this agency"] });
  }
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    scope: r.scope,
    permissions: r.rolePermissions.map((rp) => rp.permission.key),
  }));
}

/** Nobody can hand out more than they hold: every permission of a granted role must be the actor's own. */
function assertCanGrant(access: Access, roles: RoleWithPerms[]) {
  if (access.isPlatformAdmin) return;
  for (const role of roles) {
    if (!role.permissions.every((p) => access.permissions.has(p as never))) {
      throw new ForbiddenError(`You cannot grant the ${role.key} role`);
    }
  }
}

async function assertAnotherAdminRemains(db: Tx, agencyId: string, leavingUserId: string) {
  const others = await db.agencyMembership.count({
    where: {
      agencyId,
      status: "active",
      userId: { not: leavingUserId },
      user: { deactivatedAt: null },
      roles: { some: { role: { key: "agency_admin" } } },
    },
  });
  if (others === 0) throw new ConflictError("An agency needs at least one active Agency Admin");
}

// ---- Reading ---------------------------------------------------------------------------------

export async function listTeam(actor: Actor, agencyId: string) {
  await requireAgencyPermission(actor, agencyId, "agency.members");
  const db = prismaClient();
  const [members, invitations, roles, clients] = await Promise.all([
    db.agencyMembership.findMany({
      where: { agencyId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        userId: true,
        status: true,
        allClientsAccess: true,
        user: { select: { name: true, email: true, deactivatedAt: true } },
        roles: { select: { role: { select: { key: true, name: true } } } },
        clientMemberships: {
          select: {
            clientId: true,
            client: { select: { name: true } },
            roles: { select: { role: { select: { key: true } } } },
          },
        },
      },
    }),
    db.invitation.findMany({
      where: { agencyId, status: "pending", expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        expiresAt: true,
        allClientsAccess: true,
        client: { select: { id: true, name: true } },
        roles: { select: { role: { select: { key: true, name: true } } } },
      },
    }),
    db.role.findMany({
      where: { agencyId },
      orderBy: { name: "asc" },
      select: { key: true, name: true, scope: true, description: true },
    }),
    db.client.findMany({
      where: { agencyId, status: { not: "archived" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  return { members, invitations, roles, clients };
}

// ---- Invitations -----------------------------------------------------------------------------

const inviteSchema = z.object({
  agencyId: z.string().min(1),
  clientId: z.string().min(1).optional(),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
  roleKeys: roleKeysSchema,
  allClientsAccess: z.boolean().default(false),
});
export type InviteInput = z.input<typeof inviteSchema>;

export async function inviteMember(actor: Actor, input: InviteInput, now = new Date()) {
  const data = parseInput(inviteSchema, input);
  const db = prismaClient();

  // Agency-wide invites need agency.members; inviting to one client needs member.manage on it.
  let access: Access;
  if (data.clientId) {
    const ctx = await requirePermission(actor, data.clientId, "member.manage");
    if (ctx.agencyId !== data.agencyId) throw new NotFoundError("Client not found");
    access = ctx.access;
  } else {
    access = await requireAgencyPermission(actor, data.agencyId, "agency.members");
  }

  const roles = await loadRoles(db, data.agencyId, data.roleKeys);
  assertCanGrant(access, roles);
  if (!data.clientId && roles.some((r) => r.scope === "client")) {
    throw new ValidationError({
      roleKeys: ["The Client role can only be granted for a specific client"],
    });
  }
  if (data.clientId && data.allClientsAccess) {
    throw new ValidationError({
      allClientsAccess: ["All-clients access is an agency-level setting"],
    });
  }
  if (data.allClientsAccess && !access.permissions.has("agency.members")) {
    throw new ForbiddenError("Only agency admins can grant access to all clients");
  }

  const existing = await db.user.findUnique({ where: { email: data.email }, select: { id: true } });
  if (existing && !data.clientId) {
    const seat = await db.agencyMembership.findUnique({
      where: { agencyId_userId: { agencyId: data.agencyId, userId: existing.id } },
      select: { id: true },
    });
    if (seat)
      throw new ConflictError("This person is already on the team; change their roles instead");
  }

  const token = randomBytes(32).toString("base64url");
  const invitation = await db.$transaction(async (tx) => {
    // A new invite replaces any older pending one for the same person and scope.
    await tx.invitation.updateMany({
      where: {
        agencyId: data.agencyId,
        clientId: data.clientId ?? null,
        email: data.email,
        status: "pending",
      },
      data: { status: "revoked", revokedAt: now },
    });
    const created = await tx.invitation.create({
      data: {
        agencyId: data.agencyId,
        clientId: data.clientId ?? null,
        email: data.email,
        tokenHash: hashToken(token),
        allClientsAccess: data.allClientsAccess,
        invitedById: actor.userId,
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        createdAt: now,
      },
    });
    await tx.invitationRole.createMany({
      data: roles.map((r) => ({ agencyId: data.agencyId, invitationId: created.id, roleId: r.id })),
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: data.agencyId,
      clientId: data.clientId ?? null,
      action: "invitation.created",
      entityType: "invitation",
      entityId: created.id,
      after: { email: data.email, roles: data.roleKeys, allClientsAccess: data.allClientsAccess },
    });
    return created;
  });
  // The plaintext token is returned once and never stored.
  return { invitation, token };
}

export async function revokeInvitation(actor: Actor, agencyId: string, invitationId: string) {
  const db = prismaClient();
  const invitation = await db.invitation.findFirst({
    where: { id: invitationId, agencyId },
    select: { id: true, clientId: true, email: true, status: true },
  });
  // The id is checked against the agency in the URL/form so an id from another agency is "not found".
  if (!invitation) {
    await requireAgencyPermission(actor, agencyId, "agency.members");
    throw new NotFoundError("Invitation not found");
  }
  if (invitation.clientId) await requirePermission(actor, invitation.clientId, "member.manage");
  else await requireAgencyPermission(actor, agencyId, "agency.members");
  if (invitation.status !== "pending")
    throw new ConflictError("This invitation is no longer pending");

  await db.$transaction(async (tx) => {
    await tx.invitation.update({
      where: { id: invitation.id },
      data: { status: "revoked", revokedAt: new Date() },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId,
      clientId: invitation.clientId,
      action: "invitation.revoked",
      entityType: "invitation",
      entityId: invitation.id,
      before: { email: invitation.email },
    });
  });
}

/** What an invitation link is for, without accepting it. Public: possession of the token is the credential. */
export async function previewInvitation(token: string, now = new Date()) {
  const invitation = await prismaClient().invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      email: true,
      status: true,
      expiresAt: true,
      agency: { select: { name: true } },
      client: { select: { name: true } },
      roles: { select: { role: { select: { name: true } } } },
    },
  });
  if (!invitation) return null;
  const usable = invitation.status === "pending" && invitation.expiresAt > now;
  return {
    usable,
    email: invitation.email,
    agencyName: invitation.agency.name,
    clientName: invitation.client?.name ?? null,
    roles: invitation.roles.map((r) => r.role.name),
  };
}

type ClaimedInvitation = {
  id: string;
  agencyId: string;
  clientId: string | null;
  email: string;
  allClientsAccess: boolean;
  roleIds: string[];
};

/** Atomically move a pending, unexpired invitation to accepted. Only one caller can win. */
async function claimInvitation(tx: Tx, token: string, now: Date): Promise<ClaimedInvitation> {
  const found = await tx.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      agencyId: true,
      clientId: true,
      email: true,
      allClientsAccess: true,
      status: true,
      expiresAt: true,
      roles: { select: { roleId: true } },
    },
  });
  if (!found || found.status !== "pending" || found.expiresAt <= now) {
    throw new NotFoundError("This invitation is invalid or has expired");
  }
  const claimed = await tx.invitation.updateMany({
    where: { id: found.id, status: "pending", expiresAt: { gt: now } },
    data: { status: "accepted", acceptedAt: now },
  });
  if (claimed.count !== 1) throw new NotFoundError("This invitation is invalid or has expired");
  return { ...found, roleIds: found.roles.map((r) => r.roleId) };
}

async function grantFromInvitation(tx: Tx, inv: ClaimedInvitation, userId: string, now: Date) {
  const seat = await tx.agencyMembership.upsert({
    where: { agencyId_userId: { agencyId: inv.agencyId, userId } },
    update: inv.allClientsAccess
      ? { allClientsAccess: true, status: "active" }
      : { status: "active" },
    create: {
      agencyId: inv.agencyId,
      userId,
      allClientsAccess: inv.allClientsAccess,
      joinedAt: now,
    },
  });

  if (inv.clientId) {
    const clientSeat = await tx.clientMembership.upsert({
      where: { userId_clientId: { userId, clientId: inv.clientId } },
      update: { status: "active" },
      create: { agencyId: inv.agencyId, clientId: inv.clientId, userId },
    });
    await tx.clientMembershipRole.createMany({
      data: inv.roleIds.map((roleId) => ({
        agencyId: inv.agencyId,
        clientMembershipId: clientSeat.id,
        roleId,
      })),
      skipDuplicates: true,
    });
  } else {
    await tx.agencyMembershipRole.createMany({
      data: inv.roleIds.map((roleId) => ({
        agencyId: inv.agencyId,
        agencyMembershipId: seat.id,
        roleId,
      })),
      skipDuplicates: true,
    });
  }
  await recordAudit(tx, {
    actorUserId: userId,
    agencyId: inv.agencyId,
    clientId: inv.clientId,
    action: "invitation.accepted",
    entityType: "invitation",
    entityId: inv.id,
    after: { email: inv.email, clientId: inv.clientId, allClientsAccess: inv.allClientsAccess },
  });
}

/** A signed-in user accepts an invitation addressed to their own email. */
export async function acceptInvitation(userId: string, token: string, now = new Date()) {
  const db = prismaClient();
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, deactivatedAt: true },
  });
  if (!user || user.deactivatedAt) throw new ForbiddenError();
  return db.$transaction(async (tx) => {
    const inv = await claimInvitation(tx, token, now);
    if (inv.email !== user.email.toLowerCase()) {
      // Roll back the claim: the link belongs to someone else.
      throw new ForbiddenError("This invitation was sent to a different email address");
    }
    await grantFromInvitation(tx, inv, userId, now);
    return { agencyId: inv.agencyId, clientId: inv.clientId };
  });
}

/** A new person creates their account from the invitation (the invited email is fixed). */
export async function acceptInvitationWithNewAccount(
  input: { token: string; name: string; passwordHash: string },
  now = new Date(),
) {
  const name = parseInput(z.string().trim().min(1, "Enter your name").max(120), input.name);
  const db = prismaClient();
  return db.$transaction(async (tx) => {
    const inv = await claimInvitation(tx, input.token, now);
    if (await tx.user.findUnique({ where: { email: inv.email }, select: { id: true } })) {
      throw new ConflictError("An account with this email already exists; sign in to accept");
    }
    const user = await tx.user.create({
      // Following the emailed link proves control of the address.
      data: { email: inv.email, name, emailVerified: true },
    });
    await tx.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: input.passwordHash,
      },
    });
    await grantFromInvitation(tx, inv, user.id, now);
    return { userId: user.id, email: inv.email, agencyId: inv.agencyId, clientId: inv.clientId };
  });
}

// ---- Roles and removal -----------------------------------------------------------------------

const setRolesSchema = z.object({
  roleKeys: roleKeysSchema,
  allClientsAccess: z.boolean().optional(),
});

export async function setAgencyMemberRoles(
  actor: Actor,
  input: { agencyId: string; userId: string; roleKeys: RoleKey[]; allClientsAccess?: boolean },
) {
  const data = parseInput(setRolesSchema, input);
  const access = await requireAgencyPermission(actor, input.agencyId, "agency.members");
  const db = prismaClient();
  await db.$transaction(async (tx) => {
    const seat = await tx.agencyMembership.findUnique({
      where: { agencyId_userId: { agencyId: input.agencyId, userId: input.userId } },
      select: {
        id: true,
        allClientsAccess: true,
        roles: { select: { role: { select: { key: true } } } },
      },
    });
    if (!seat) throw new NotFoundError("Team member not found");
    const roles = await loadRoles(tx, input.agencyId, data.roleKeys);
    if (roles.some((r) => r.scope === "client")) {
      throw new ValidationError({
        roleKeys: ["The Client role is granted per client, not agency-wide"],
      });
    }
    assertCanGrant(access, roles);
    const before = {
      roles: seat.roles.map((r) => r.role.key),
      allClientsAccess: seat.allClientsAccess,
    };
    if (before.roles.includes("agency_admin") && !data.roleKeys.includes("agency_admin")) {
      await assertAnotherAdminRemains(tx, input.agencyId, input.userId);
    }
    await tx.agencyMembershipRole.deleteMany({ where: { agencyMembershipId: seat.id } });
    await tx.agencyMembershipRole.createMany({
      data: roles.map((r) => ({
        agencyId: input.agencyId,
        agencyMembershipId: seat.id,
        roleId: r.id,
      })),
    });
    if (data.allClientsAccess !== undefined) {
      await tx.agencyMembership.update({
        where: { id: seat.id },
        data: { allClientsAccess: data.allClientsAccess },
      });
    }
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: input.agencyId,
      clientId: null,
      action: "membership.roles_changed",
      entityType: "agency_membership",
      entityId: seat.id,
      before,
      after: {
        roles: data.roleKeys,
        allClientsAccess: data.allClientsAccess ?? before.allClientsAccess,
      },
    });
  });
}

export async function removeAgencyMember(actor: Actor, agencyId: string, userId: string) {
  await requireAgencyPermission(actor, agencyId, "agency.members");
  const db = prismaClient();
  await db.$transaction(async (tx) => {
    const seat = await tx.agencyMembership.findUnique({
      where: { agencyId_userId: { agencyId, userId } },
      select: { id: true, roles: { select: { role: { select: { key: true } } } } },
    });
    if (!seat) throw new NotFoundError("Team member not found");
    if (seat.roles.some((r) => r.role.key === "agency_admin")) {
      await assertAnotherAdminRemains(tx, agencyId, userId);
    }
    // Work assigned to the person goes back to the pool; their history stays.
    await tx.task.updateMany({
      where: { agencyId, assigneeId: userId },
      data: { assigneeId: null },
    });
    await tx.contentItem.updateMany({
      where: { agencyId, assignedToId: userId },
      data: { assignedToId: null },
    });
    // Cascades to client memberships, their roles and project memberships.
    await tx.agencyMembership.delete({ where: { id: seat.id } });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId,
      clientId: null,
      action: "membership.removed",
      entityType: "agency_membership",
      entityId: seat.id,
      before: { userId, roles: seat.roles.map((r) => r.role.key) },
    });
  });
}

export async function setClientMemberRoles(
  actor: Actor,
  input: { clientId: string; userId: string; roleKeys: RoleKey[] },
) {
  const data = parseInput(z.object({ roleKeys: roleKeysSchema }), input);
  const ctx = await requirePermission(actor, input.clientId, "member.manage");
  const db = prismaClient();
  await db.$transaction(async (tx) => {
    const seat = await tx.clientMembership.findUnique({
      where: { userId_clientId: { userId: input.userId, clientId: input.clientId } },
      select: { id: true, roles: { select: { role: { select: { key: true } } } } },
    });
    if (!seat) throw new NotFoundError("Team member not found");
    const roles = await loadRoles(tx, ctx.agencyId, data.roleKeys);
    assertCanGrant(ctx.access, roles);
    await tx.clientMembershipRole.deleteMany({ where: { clientMembershipId: seat.id } });
    await tx.clientMembershipRole.createMany({
      data: roles.map((r) => ({
        agencyId: ctx.agencyId,
        clientMembershipId: seat.id,
        roleId: r.id,
      })),
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: input.clientId,
      action: "membership.roles_changed",
      entityType: "client_membership",
      entityId: seat.id,
      before: { roles: seat.roles.map((r) => r.role.key) },
      after: { roles: data.roleKeys },
    });
  });
}

export async function removeClientMember(actor: Actor, clientId: string, userId: string) {
  const ctx = await requirePermission(actor, clientId, "member.manage");
  const db = prismaClient();
  await db.$transaction(async (tx) => {
    const seat = await tx.clientMembership.findUnique({
      where: { userId_clientId: { userId, clientId } },
      select: { id: true },
    });
    if (!seat) throw new NotFoundError("Team member not found");
    await tx.task.updateMany({
      where: { clientId, assigneeId: userId },
      data: { assigneeId: null },
    });
    await tx.contentItem.updateMany({
      where: { clientId, assignedToId: userId },
      data: { assignedToId: null },
    });
    await tx.clientMembership.delete({ where: { id: seat.id } });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId,
      action: "membership.removed",
      entityType: "client_membership",
      entityId: seat.id,
      before: { userId },
    });
  });
}

// ---- Accounts --------------------------------------------------------------------------------

/** Platform admins only: block sign-in, end all sessions. History that mentions the user is kept. */
export async function setUserActive(actor: Actor, userId: string, active: boolean) {
  if (!actor.isAdmin) throw new ForbiddenError("Platform admin access required");
  if (!active && userId === actor.userId) throw new ConflictError("You cannot deactivate yourself");
  const db = prismaClient();
  await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, deactivatedAt: true },
    });
    if (!user) throw new NotFoundError("User not found");
    await tx.user.update({
      where: { id: userId },
      data: { deactivatedAt: active ? null : new Date() },
    });
    if (!active) await tx.session.deleteMany({ where: { userId } });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      clientId: null,
      action: active ? "user.reactivated" : "user.deactivated",
      entityType: "user",
      entityId: userId,
    });
  });
}
