import { getUnscopedPrisma } from "../src/unsafe";
import type { Actor } from "../src/access";
import { provisionAgencyRoles, syncRbac, type RoleKey } from "../src/rbac";

export const prisma = () => getUnscopedPrisma();

let defaultAgencyId: string | undefined;

export async function resetDb() {
  // Row-level append-only triggers do not fire on TRUNCATE, so tests can reset everything.
  await prisma().$executeRawUnsafe(
    'TRUNCATE "agencies","clients","integrations","metric_definitions","audit_log","job_runs","sessions","accounts","verifications","users" RESTART IDENTITY CASCADE',
  );
  defaultAgencyId = undefined;
  await syncRbac(prisma());
}

let counter = 0;

export async function makeUser(isAdmin = false): Promise<Actor> {
  counter++;
  const user = await prisma().user.create({
    data: { email: `user${counter}-${Date.now()}@example.com`, name: `User ${counter}`, isAdmin },
  });
  return { userId: user.id, isAdmin };
}

/** An agency with its default roles. */
export async function makeAgency(name: string, slug = name.toLowerCase().replace(/\s+/g, "-")) {
  const agency = await prisma().agency.create({ data: { name, slug } });
  await provisionAgencyRoles(prisma(), agency.id);
  return agency;
}

/** The single agency used by makeClient when none is given (created on first use). */
export async function getDefaultAgencyId() {
  defaultAgencyId ??= (await makeAgency("Test Agency", "test-agency")).id;
  return defaultAgencyId;
}

export async function makeClient(
  name: string,
  slug = name.toLowerCase().replace(/\s+/g, "-"),
  agencyId?: string,
) {
  return prisma().client.create({
    data: { name, slug, agencyId: agencyId ?? (await getDefaultAgencyId()) },
  });
}

export async function roleId(agencyId: string, key: RoleKey) {
  return (await prisma().role.findFirstOrThrow({ where: { agencyId, key } })).id;
}

const asArray = <T>(v: T | T[]) => (Array.isArray(v) ? v : [v]);

/** Give a user a seat in an agency with the given role(s) (needed before they can be a client member). */
export async function addAgencyStaff(
  actor: Actor,
  agencyId: string,
  roles: RoleKey | RoleKey[] = "reviewer",
  allClientsAccess = false,
) {
  const seat = await prisma().agencyMembership.upsert({
    where: { agencyId_userId: { agencyId, userId: actor.userId } },
    update: { allClientsAccess },
    create: { agencyId, userId: actor.userId, allClientsAccess },
  });
  await prisma().agencyMembershipRole.deleteMany({ where: { agencyMembershipId: seat.id } });
  for (const key of asArray(roles)) {
    await prisma().agencyMembershipRole.create({
      data: { agencyId, agencyMembershipId: seat.id, roleId: await roleId(agencyId, key) },
    });
  }
  return seat;
}

/** Add a user to a client with the given role(s) (and give them a bare agency seat if needed). */
export async function addMember(actor: Actor, clientId: string, roles: RoleKey | RoleKey[]) {
  const client = await prisma().client.findUniqueOrThrow({ where: { id: clientId } });
  const existing = await prisma().agencyMembership.findUnique({
    where: { agencyId_userId: { agencyId: client.agencyId, userId: actor.userId } },
  });
  if (!existing) {
    await prisma().agencyMembership.create({
      data: { agencyId: client.agencyId, userId: actor.userId },
    });
  }
  const seat = await prisma().clientMembership.create({
    data: { agencyId: client.agencyId, clientId, userId: actor.userId },
  });
  for (const key of asArray(roles)) {
    await prisma().clientMembershipRole.create({
      data: {
        agencyId: client.agencyId,
        clientMembershipId: seat.id,
        roleId: await roleId(client.agencyId, key),
      },
    });
  }
  return seat;
}
