/**
 * UNSAFE: the raw, unscoped Prisma client.
 *
 * Import this only from code that is not customer-scoped by nature: the auth
 * adapter, the seed script and this package's own access layer. Everything else
 * must use forCustomer / forCustomers / forAdmin / forSystem from "@automation/db".
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { dbEnvSchema, loadEnv } from "@automation/config";
import { PrismaClient } from "./generated/client";

export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

export function getUnscopedPrisma(): PrismaClient {
  globalForPrisma.__prisma ??= createPrismaClient(loadEnv(dbEnvSchema).DATABASE_URL);
  return globalForPrisma.__prisma;
}

export type { PrismaClient };
