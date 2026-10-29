import { describe, expect, it } from "vitest";
import { EnvError, loadEnv, webEnvSchema, workerEnvSchema } from "./env";

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
    });
    expect(env.HEARTBEAT_INTERVAL_MS).toBe(300_000);
  });
});
