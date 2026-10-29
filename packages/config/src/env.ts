import { z } from "zod";

const databaseUrl = z.string().min(1, "is required").pipe(z.url());

export const dbEnvSchema = z.object({
  DATABASE_URL: databaseUrl,
});

export const webEnvSchema = dbEnvSchema.extend({
  APP_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
  // Outgoing email (invitations, password reset). "log" prints the message to the server console
  // and is refused in production; "resend" sends through the Resend HTTP API.
  MAIL_TRANSPORT: z.enum(["log", "resend"]).default("log"),
  EMAIL_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(3).optional(),
});

/** 32-byte key as 64 hex chars or base64 (generate: `openssl rand -base64 32`). */
const encryptionKey = z
  .string()
  .min(1, "is required")
  .refine((v) => {
    const t = v.trim();
    return /^[0-9a-fA-F]{64}$/.test(t) || Buffer.from(t, "base64").length === 32;
  }, "must be 32 bytes (64 hex chars or base64)");

export const encryptionEnvSchema = z.object({
  ENCRYPTION_KEY: encryptionKey,
  // Comma-separated retired keys, kept only so old ciphertext can still be decrypted.
  ENCRYPTION_KEY_PREVIOUS: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean)
        : [],
    ),
});

export const workerEnvSchema = dbEnvSchema.extend({
  REDIS_URL: z.string().min(1, "is required").pipe(z.url()),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1000).default(300_000),
});

export const seedEnvSchema = dbEnvSchema.extend({
  SEED_ADMIN_EMAIL: z.email(),
  SEED_ADMIN_PASSWORD: z.string().min(12, "must be at least 12 characters"),
  SEED_ADMIN_NAME: z.string().min(1).default("Admin"),
  // Development only: password shared by the sample users (one per role). Unset = none created.
  SEED_DEV_USER_PASSWORD: z.string().min(12, "must be at least 12 characters").optional(),
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

export type EncryptionEnv = z.output<typeof encryptionEnvSchema>;
export type WebEnv = z.output<typeof webEnvSchema>;
export type WorkerEnv = z.output<typeof workerEnvSchema>;
export type SeedEnv = z.output<typeof seedEnvSchema>;
