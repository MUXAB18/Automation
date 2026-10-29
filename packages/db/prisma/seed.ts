import path from "node:path";
import { config } from "dotenv";
import { hashPassword } from "better-auth/crypto";
import { loadEnv, seedEnvSchema } from "@automation/config";
import { createPrismaClient } from "../src/unsafe";

config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

async function main() {
  const env = loadEnv(seedEnvSchema);
  const prisma = createPrismaClient(env.DATABASE_URL);

  try {
    const email = env.SEED_ADMIN_EMAIL.toLowerCase();
    let admin = await prisma.user.findUnique({ where: { email } });
    if (!admin) {
      admin = await prisma.user.create({
        data: {
          email,
          name: env.SEED_ADMIN_NAME,
          emailVerified: true,
          isAdmin: true,
          accounts: {
            create: {
              accountId: email,
              providerId: "credential",
              password: await hashPassword(env.SEED_ADMIN_PASSWORD),
            },
          },
        },
      });
      console.log(`Created admin user ${email}`);
    } else {
      console.log(`Admin user ${email} already exists (password left unchanged)`);
    }

    const customer = await prisma.customer.upsert({
      where: { slug: "sarj-worldwide" },
      update: {},
      create: { name: "SARJ Worldwide", slug: "sarj-worldwide", reportIntervalDays: 15 },
    });
    await prisma.website.upsert({
      where: { customerId_domain: { customerId: customer.id, domain: "sarjworldwide.ca" } },
      update: {},
      create: { customerId: customer.id, domain: "sarjworldwide.ca", isPrimary: true },
    });
    console.log(`Customer ready: ${customer.name} (sarjworldwide.ca)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
