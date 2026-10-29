import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { getUnscopedPrisma } from "@automation/db/unsafe";
import { getWebEnv } from "./env";

const env = getWebEnv();

export const auth = betterAuth({
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  // Auth tables are not customer-owned, so the raw client is correct here.
  database: prismaAdapter(getUnscopedPrisma(), { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    // Accounts are created by admins (seed / later user management), never self-serve.
    disableSignUp: true,
    minPasswordLength: 12,
  },
  user: {
    additionalFields: {
      isAdmin: { type: "boolean", defaultValue: false, input: false },
    },
  },
  advanced: { database: { generateId: "uuid" } },
  plugins: [nextCookies()],
});
