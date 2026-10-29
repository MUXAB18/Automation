import { getUnscopedPrisma } from "../src/unsafe";
import type { Actor } from "../src/access";

export const prisma = () => getUnscopedPrisma();

export async function resetDb() {
  await prisma().$executeRawUnsafe(
    'TRUNCATE "audit_log","job_runs","integration_connections","websites","memberships","customers","sessions","accounts","verifications","users" RESTART IDENTITY CASCADE',
  );
}

let counter = 0;

export async function makeUser(isAdmin = false): Promise<Actor> {
  counter++;
  const user = await prisma().user.create({
    data: { email: `user${counter}-${Date.now()}@example.com`, name: `User ${counter}`, isAdmin },
  });
  return { userId: user.id, isAdmin };
}

export async function makeCustomer(name: string, slug = name.toLowerCase().replace(/\s+/g, "-")) {
  return prisma().customer.create({ data: { name, slug } });
}

export async function addMember(actor: Actor, customerId: string, role: "admin" | "member" | "viewer") {
  return prisma().membership.create({ data: { userId: actor.userId, customerId, role } });
}
