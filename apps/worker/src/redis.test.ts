import { describe, expect, it } from "vitest";
import { redisConnection } from "./redis";

describe("redisConnection", () => {
  it("parses a plain url", () => {
    expect(redisConnection("redis://localhost:6379")).toMatchObject({
      host: "localhost",
      port: 6379,
    });
  });

  it("parses credentials, db and tls", () => {
    expect(redisConnection("rediss://app:p%40ss@redis.example.com:6380/2")).toMatchObject({
      host: "redis.example.com",
      port: 6380,
      username: "app",
      password: "p@ss",
      db: 2,
      tls: {},
    });
  });

  it("always disables per-request retries, as BullMQ workers require", () => {
    expect(redisConnection("redis://localhost")).toMatchObject({ maxRetriesPerRequest: null });
  });
});
