import { execSync } from "node:child_process";

/** Apply migrations to the dedicated test database before any test runs. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is required to run db tests (see .env.example)");
  if (url === process.env.DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL: tests wipe their database");
  }
  execSync("npx prisma migrate deploy", {
    cwd: import.meta.dirname + "/..",
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
