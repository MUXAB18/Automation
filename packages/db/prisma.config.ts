import path from "node:path";
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Load the monorepo-root .env (Prisma 7 no longer loads env files itself).
config({ path: path.resolve(import.meta.dirname, "../../.env"), quiet: true });

export default defineConfig({
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Placeholder lets `prisma generate` run without a database (e.g. fresh install / CI).
    url: process.env.DATABASE_URL ?? "postgresql://placeholder@localhost:5432/placeholder",
  },
});
