import { z } from "zod";

const databaseUrl = z.string().min(1, "is required").pipe(z.url());

export const dbEnvSchema = z.object({
  DATABASE_URL: databaseUrl,
});

export const webEnvSchema = dbEnvSchema.extend({
  APP_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
});

export const workerEnvSchema = dbEnvSchema.extend({
  REDIS_URL: z.string().min(1, "is required").pipe(z.url()),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1000).default(300_000),
});

export const seedEnvSchema = dbEnvSchema.extend({
  SEED_ADMIN_EMAIL: z.email(),
  SEED_ADMIN_PASSWORD: z.string().min(12, "must be at least 12 characters"),
  SEED_ADMIN_NAME: z.string().min(1).default("Admin"),
});

export class EnvError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment variables:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "EnvError";
  }
}

/** Parse and validate env vars. Throws EnvError listing every problem (fail fast). */
export function loadEnv<S extends z.ZodType>(
  schema: S,
  source: Record<string, string | undefined> = process.env,
): z.output<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }
  return result.data;
}

export type WebEnv = z.output<typeof webEnvSchema>;
export type WorkerEnv = z.output<typeof workerEnvSchema>;
export type SeedEnv = z.output<typeof seedEnvSchema>;
