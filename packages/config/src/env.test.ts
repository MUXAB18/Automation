import { describe, expect, it } from "vitest";
import {
  EnvError,
  encryptionEnvSchema,
  googleEnvSchema,
  loadEnv,
  webEnvSchema,
  workerEnvSchema,
} from "./env";

const web = {
  DATABASE_URL: "postgresql://user@localhost:5432/automation",
  APP_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "x".repeat(32),
};

describe("loadEnv", () => {
  it("parses a valid web env", () => {
    expect(loadEnv(webEnvSchema, web).APP_URL).toBe("http://localhost:3000");
  });

  it("fails fast and lists every missing variable", () => {
    try {
      loadEnv(webEnvSchema, {});
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      const message = (error as EnvError).message;
      expect(message).toContain("DATABASE_URL");
      expect(message).toContain("APP_URL");
      expect(message).toContain("BETTER_AUTH_SECRET");
    }
  });

  it("rejects a short auth secret", () => {
    expect(() => loadEnv(webEnvSchema, { ...web, BETTER_AUTH_SECRET: "short" })).toThrow(EnvError);
  });

  it("applies the worker heartbeat default", () => {
    const env = loadEnv(workerEnvSchema, {
      DATABASE_URL: web.DATABASE_URL,
      REDIS_URL: "redis://localhost:6379",
      ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    });
    expect(env.HEARTBEAT_INTERVAL_MS).toBe(300_000);
    expect(env.SYNC_POLL_INTERVAL_MS).toBe(15_000);
  });

  it("treats empty values as not set, so optional integrations can be left blank", () => {
    const env = loadEnv(workerEnvSchema, {
      DATABASE_URL: web.DATABASE_URL,
      REDIS_URL: "redis://localhost:6379",
      ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
      GHL_CLIENT_ID: "",
      GHL_CLIENT_SECRET: "",
      GHL_REDIRECT_URI: "",
      GHL_PUBLISHING_ENABLED: "",
    });
    expect(env.GHL_CLIENT_ID).toBeUndefined();
    expect(env.GHL_PUBLISHING_ENABLED).toBe("0");
  });

  it("needs all three Google OAuth settings or none", () => {
    const base = {
      DATABASE_URL: web.DATABASE_URL,
      REDIS_URL: "redis://localhost:6379",
      ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    };
    expect(() => loadEnv(workerEnvSchema, { ...base, GOOGLE_CLIENT_ID: "x" })).toThrow(
      /GOOGLE_CLIENT_ID/,
    );
    expect(loadEnv(workerEnvSchema, base).GOOGLE_CLIENT_ID).toBeUndefined();
    expect(
      loadEnv(googleEnvSchema, {
        GOOGLE_CLIENT_ID: "a",
        GOOGLE_CLIENT_SECRET: "b",
        GOOGLE_REDIRECT_URI: "https://x.test/cb",
      }).GOOGLE_CLIENT_ID,
    ).toBe("a");
  });

  it("still reports a required value that is blank", () => {
    expect(() => loadEnv(webEnvSchema, { ...web, DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
  });

  it("requires the encryption key so the worker can read stored credentials", () => {
    expect(() =>
      loadEnv(workerEnvSchema, {
        DATABASE_URL: web.DATABASE_URL,
        REDIS_URL: "redis://localhost:6379",
      }),
    ).toThrow(/ENCRYPTION_KEY/);
  });
});

describe("encryptionEnvSchema", () => {
  it("accepts a 32-byte base64 key and parses previous keys", () => {
    const key = Buffer.alloc(32, 1).toString("base64");
    const env = loadEnv(encryptionEnvSchema, {
      ENCRYPTION_KEY: key,
      ENCRYPTION_KEY_PREVIOUS: `${key}, ${key}`,
    });
    expect(env.ENCRYPTION_KEY_PREVIOUS).toHaveLength(2);
  });

  it("rejects missing or short keys", () => {
    expect(() => loadEnv(encryptionEnvSchema, {})).toThrow(EnvError);
    expect(() => loadEnv(encryptionEnvSchema, { ENCRYPTION_KEY: "short" })).toThrow(/32 bytes/);
  });
});
