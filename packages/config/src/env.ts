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

/**
 * GoHighLevel marketplace app credentials (platform-wide, not per client). All three or none: without
 * them GoHighLevel can only be connected as the development mock.
 */
const ghlShape = {
  GHL_CLIENT_ID: z.string().min(1).optional(),
  GHL_CLIENT_SECRET: z.string().min(1).optional(),
  GHL_REDIRECT_URI: z.url().optional(),
  // Posting has not been verified against a real account yet, so it stays off until someone turns it on.
  GHL_PUBLISHING_ENABLED: z.enum(["0", "1"]).default("0"),
};

const ghlTogether = (
  v: { GHL_CLIENT_ID?: string; GHL_CLIENT_SECRET?: string; GHL_REDIRECT_URI?: string },
  ctx: z.RefinementCtx,
) => {
  const set = [v.GHL_CLIENT_ID, v.GHL_CLIENT_SECRET, v.GHL_REDIRECT_URI].filter(Boolean).length;
  if (set !== 0 && set !== 3)
    ctx.addIssue({
      code: "custom",
      message: "GHL_CLIENT_ID, GHL_CLIENT_SECRET and GHL_REDIRECT_URI must be set together",
    });
};

export const ghlEnvSchema = z.object(ghlShape).superRefine(ghlTogether);

/** Google OAuth client for "Sign in with Google" connections. All three or none; service accounts need none. */
const googleShape = {
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_REDIRECT_URI: z.url().optional(),
};
const googleTogether = (
  v: { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; GOOGLE_REDIRECT_URI?: string },
  ctx: z.RefinementCtx,
) => {
  const set = [v.GOOGLE_CLIENT_ID, v.GOOGLE_CLIENT_SECRET, v.GOOGLE_REDIRECT_URI].filter(
    Boolean,
  ).length;
  if (set !== 0 && set !== 3)
    ctx.addIssue({
      code: "custom",
      message:
        "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI must be set together",
    });
};
export const googleEnvSchema = z.object(googleShape).superRefine(googleTogether);

// AI generation. "mock" needs no credentials: deterministic placeholder output for local development and tests.
const aiShape = {
  AI_PROVIDER: z.enum(["mock", "anthropic", "openai_compatible"]).default("mock"),
  AI_MODEL: z.string().min(1).optional(),
  AI_API_KEY: z.string().min(1).optional(),
  AI_BASE_URL: z.url().optional(),
  AI_DEFAULT_MONTHLY_REQUESTS: z.coerce.number().int().min(0).default(200),
  // USD; 0 = no default cost cap.
  AI_DEFAULT_MONTHLY_COST_USD: z.coerce.number().min(0).default(0),
  AI_PER_USER_HOURLY: z.coerce.number().int().min(1).default(30),
  // {"model-name": {"inputPerMTok": 3, "outputPerMTok": 15}}: estimates only, there is no built-in price list.
  AI_PRICING_JSON: z.string().optional(),
};
const aiChecks = (
  v: {
    AI_PROVIDER: string;
    AI_API_KEY?: string;
    AI_BASE_URL?: string;
    AI_MODEL?: string;
    AI_PRICING_JSON?: string;
  },
  ctx: z.RefinementCtx,
) => {
  if (v.AI_PROVIDER !== "mock" && !v.AI_MODEL)
    ctx.addIssue({
      code: "custom",
      path: ["AI_MODEL"],
      message: "is required when AI_PROVIDER is not mock",
    });
  if (v.AI_PROVIDER === "anthropic" && !v.AI_API_KEY)
    ctx.addIssue({ code: "custom", path: ["AI_API_KEY"], message: "is required for anthropic" });
  if (v.AI_PROVIDER === "openai_compatible" && !v.AI_BASE_URL)
    ctx.addIssue({
      code: "custom",
      path: ["AI_BASE_URL"],
      message: "is required for openai_compatible",
    });
  if (v.AI_PRICING_JSON) {
    try {
      z.record(
        z.string(),
        z.object({ inputPerMTok: z.number().min(0), outputPerMTok: z.number().min(0) }),
      ).parse(JSON.parse(v.AI_PRICING_JSON));
    } catch {
      ctx.addIssue({
        code: "custom",
        path: ["AI_PRICING_JSON"],
        message: 'must be JSON like {"model":{"inputPerMTok":1,"outputPerMTok":2}}',
      });
    }
  }
};

export type AiEnv = z.output<z.ZodObject<typeof aiShape>>;
export function aiRuntimeFromEnv(env: AiEnv) {
  return {
    provider: env.AI_PROVIDER,
    model: env.AI_MODEL ?? "mock-1",
    defaultMonthlyRequests: env.AI_DEFAULT_MONTHLY_REQUESTS,
    defaultMonthlyCostUsd: env.AI_DEFAULT_MONTHLY_COST_USD,
    perUserHourly: env.AI_PER_USER_HOURLY,
    pricing: env.AI_PRICING_JSON
      ? (JSON.parse(env.AI_PRICING_JSON) as Record<
          string,
          { inputPerMTok: number; outputPerMTok: number }
        >)
      : undefined,
  };
}

export const workerEnvSchema = dbEnvSchema
  .extend({
    REDIS_URL: z.string().min(1, "is required").pipe(z.url()),
    HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1000).default(300_000),
    // How often the worker looks for queued and due integration syncs.
    SYNC_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).default(15_000),
    // How often the worker looks for automation rules that are due.
    AUTOMATION_POLL_INTERVAL_MS: z.coerce.number().int().min(10_000).default(60_000),
    ...encryptionEnvSchema.shape,
    ...ghlShape,
    ...googleShape,
    ...aiShape,
    // Outgoing email for report delivery. "log" prints the message (development only; refused in production).
    MAIL_TRANSPORT: z.enum(["log", "resend"]).default("log"),
    EMAIL_API_KEY: z.string().min(1).optional(),
    EMAIL_FROM: z.string().min(3).optional(),
    // How often the worker looks for due schedules, reports to generate and deliveries to send.
    REPORT_POLL_INTERVAL_MS: z.coerce.number().int().min(5000).default(60_000),
    // Port of the worker's health endpoint (GET /health) used by container probes. 0 turns it off.
    WORKER_HEALTH_PORT: z.coerce.number().int().min(0).max(65535).default(8081),
  })
  .superRefine(ghlTogether)
  .superRefine(googleTogether)
  .superRefine(aiChecks);

export const aiEnvSchema = z.object(aiShape).superRefine(aiChecks);

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
  // An empty value means "not set": Docker Compose and .env files pass unset optional settings as "".
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ""));
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }
  return result.data;
}

export type GhlEnv = z.output<typeof ghlEnvSchema>;
export type EncryptionEnv = z.output<typeof encryptionEnvSchema>;
export type WebEnv = z.output<typeof webEnvSchema>;
export type WorkerEnv = z.output<typeof workerEnvSchema>;
export type SeedEnv = z.output<typeof seedEnvSchema>;
