import { describe, expect, it, vi } from "vitest";

import { ProviderError, errorFromStatus, toProviderError } from "./errors";
import { createMockAdapter } from "./mock-adapter";
import { PROVIDERS } from "./providers";
import { RateLimiter, type Clock } from "./rate-limiter";
import { redact } from "./redact";
import { AdapterRegistry } from "./registry";
import { withRetry } from "./retry";
import { runSync } from "./runner";
import type { NormalizedRecord, SyncSink } from "./types";

function fakeClock(): Clock & { t: number; sleeps: number[] } {
  const c = {
    t: 0,
    sleeps: [] as number[],
    now: () => c.t,
    sleep: async (ms: number) => {
      c.sleeps.push(ms);
      c.t += ms;
    },
  };
  return c;
}

describe("errors", () => {
  it("maps statuses and flags retry / reconnect", () => {
    expect(errorFromStatus(401)).toMatchObject({
      code: "auth_failed",
      needsReconnect: true,
      retryable: false,
    });
    expect(errorFromStatus(403).code).toBe("insufficient_scope");
    expect(errorFromStatus(429, 2)).toMatchObject({
      code: "rate_limited",
      retryable: true,
      retryAfterMs: 2000,
    });
    expect(errorFromStatus(503)).toMatchObject({ code: "provider_unavailable", retryable: true });
    expect(errorFromStatus(400).retryable).toBe(false);
  });
  it("never leaks the message of unknown errors", () => {
    const e = toProviderError(new Error("token=abc123secret"));
    expect(e.safeMessage).not.toContain("abc123");
    expect(toProviderError(new TypeError("fetch failed")).code).toBe("network");
    expect(toProviderError(Object.assign(new Error("x"), { name: "TimeoutError" })).code).toBe(
      "timeout",
    );
  });
});

describe("redact", () => {
  it("removes secrets, bearer tokens and ciphertext", () => {
    const text =
      'Authorization: Bearer abcdefghijkl and ?api_key=XYZ123 and {"access_token":"tok"} mysecretvalue v1.abcd1234.aaa.bbb.ccc';
    const out = redact(text, ["mysecretvalue"]);
    for (const leaked of ["abcdefghijkl", "XYZ123", '"tok"', "mysecretvalue", "v1.abcd1234"])
      expect(out).not.toContain(leaked);
  });
});

describe("rate limiter", () => {
  it("allows a burst then spaces calls by the refill rate", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ perSecond: 2, burst: 2 }, clock);
    await limiter.acquire("a");
    await limiter.acquire("a");
    expect(clock.t).toBe(0);
    await limiter.acquire("a");
    expect(clock.t).toBeGreaterThanOrEqual(500);
  });
  it("keeps keys independent and honours penalties", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ perSecond: 100, burst: 100 }, clock);
    limiter.penalize("a", 3000);
    await limiter.acquire("b");
    expect(clock.t).toBe(0);
    await limiter.acquire("a");
    expect(clock.t).toBeGreaterThanOrEqual(3000);
  });
});

describe("withRetry", () => {
  it("retries retryable errors using Retry-After when given", async () => {
    const clock = fakeClock();
    const op = vi.fn().mockRejectedValueOnce(errorFromStatus(429, 4)).mockResolvedValue("ok");
    expect(await withRetry(op, { clock })).toBe("ok");
    expect(clock.sleeps).toEqual([4000]);
  });
  it("does not retry auth failures and stops at maxAttempts", async () => {
    const auth = vi.fn().mockRejectedValue(errorFromStatus(401));
    await expect(withRetry(auth, { clock: fakeClock() })).rejects.toMatchObject({
      code: "auth_failed",
    });
    expect(auth).toHaveBeenCalledTimes(1);
    const down = vi.fn().mockRejectedValue(errorFromStatus(500));
    await expect(withRetry(down, { clock: fakeClock(), maxAttempts: 3 })).rejects.toBeInstanceOf(
      ProviderError,
    );
    expect(down).toHaveBeenCalledTimes(3);
  });
});

function memorySink() {
  const rows: NormalizedRecord[] = [];
  const sink: SyncSink = { write: async (records) => (rows.push(...records), records.length) };
  return { rows, sink };
}
// A two-resource provider keeps the arithmetic in these tests obvious.
const gsc = { ...PROVIDERS.find((p) => p.key === "google_search_console")!, resources: ["resource_a", "resource_b"] as const };
const base = (scenario: string) => {
  const clock = fakeClock();
  const mem = memorySink();
  return {
    clock,
    mem,
    run: () =>
      runSync({
        adapter: createMockAdapter(gsc),
        credentials: { scenario },
        ctx: { accountId: "acc-" + scenario, clientId: "c1" },
        sink: mem.sink,
        limiter: new RateLimiter({ perSecond: 1000, burst: 1000 }, clock),
        clock,
      }),
  };
};

describe("runSync with the mock adapter", () => {
  it("paginates every resource, normalizes, persists and tags the data as mock", async () => {
    const t = base("healthy");
    const out = await t.run();
    expect(out).toMatchObject({
      status: "succeeded",
      rowsFetched: 12,
      rowsWritten: 12,
      source: "mock",
    });
    expect(t.mem.rows.every((r) => r.source === "mock")).toBe(true);
  });
  it("recovers from transient failures", async () => {
    const out = await base("flaky").run();
    expect(out.status).toBe("succeeded");
  });
  it("reports partial when one resource fails and keeps the other", async () => {
    const out = await base("partial").run();
    expect(out.status).toBe("partial");
    expect(out.rowsWritten).toBe(6);
    expect(out.errors).toEqual([
      expect.objectContaining({
        code: "provider_unavailable",
        resource: gsc.resources[1],
        retryable: true,
      }),
    ]);
  });
  it("stops on auth failure and asks for reconnection", async () => {
    const out = await base("auth_failed").run();
    expect(out).toMatchObject({ status: "failed", needsReconnect: true, rowsWritten: 0 });
    expect(out.errors).toHaveLength(1);
  });
  it("fails with a retry hint when rate limited", async () => {
    const out = await base("rate_limited").run();
    expect(out.status).toBe("failed");
    expect(out.errors[0]?.retryable).toBe(true);
    expect(out.retryAfterMs).toBeGreaterThan(0);
  });
  it("stops a provider that loops its cursor", async () => {
    const adapter = createMockAdapter(gsc);
    adapter.fetchPage = async () => ({ items: [], nextCursor: "same" });
    const clock = fakeClock();
    const out = await runSync({
      adapter,
      credentials: {},
      ctx: { accountId: "a", clientId: "c" },
      sink: memorySink().sink,
      limiter: new RateLimiter({ perSecond: 1000 }, clock),
      clock,
    });
    expect(out.errors[0]?.code).toBe("invalid_response");
  });
});

describe("registry and providers", () => {
  it("serves mocks for all four providers and refuses a live adapter that is not registered", () => {
    const registry = new AdapterRegistry();
    for (const key of [
      "gohighlevel",
      "se_ranking",
      "google_analytics_4",
      "google_search_console",
    ]) {
      expect(registry.get(key, "mock").isMock).toBe(true);
      expect(() => registry.get(key, "live")).toThrow(/No live adapter/);
    }
    // All four providers have real adapters now; the catalogue must say so.
    expect(PROVIDERS.every((p) => p.live)).toBe(true);
  });
  it("mock connection test fails honestly per scenario", async () => {
    const adapter = createMockAdapter(gsc);
    const ctx = { accountId: "a", clientId: "c1234567" };
    expect((await adapter.testConnection({ scenario: "healthy" }, ctx)).ok).toBe(true);
    expect(await adapter.testConnection({ scenario: "auth_failed" }, ctx)).toMatchObject({
      ok: false,
    });
  });
});
