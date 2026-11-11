import { describe, expect, it } from "vitest";
import { AdapterRegistry, PROVIDERS, RateLimiter } from "@automation/integrations";
import { executeRun, discardSink } from "./sync-dispatch";
import type { SyncExecution } from "@automation/db";

const exec = (over: Partial<SyncExecution>): SyncExecution => ({
  runId: "r",
  accountId: "a",
  clientId: "c",
  agencyId: "g",
  providerKey: "se_ranking",
  isMock: true,
  lastSyncedAt: null,
  scopes: [],
  credentials: { scenario: "healthy" },
  ...over,
});
const deps = { registry: new AdapterRegistry(), limiter: new RateLimiter({ perSecond: 1000 }) };

describe("executeRun", () => {
  it("runs a mock account and reports that nothing was persisted", async () => {
    const r = await executeRun(exec({}), deps);
    expect(r).toMatchObject({
      status: "succeeded",
      rowsFetched: 6 * PROVIDERS.find((p) => p.key === "se_ranking")!.resources.length,
      rowsWritten: 0,
    });
    expect(await discardSink.write([], { resource: "x" })).toBe(0);
  });
  it("fails honestly for a live account when no live adapter exists", async () => {
    const r = await executeRun(
      exec({ isMock: false, credentials: { apiKey: "sk-verysecretvalue" } }),
      deps,
    );
    expect(r.status).toBe("failed");
    expect(r.errors[0]).toMatchObject({ code: "invalid_request", retryable: false });
    expect(r.errors[0]?.message).toMatch(/not available yet/);
    expect(JSON.stringify(r)).not.toContain("verysecretvalue");
  });
  it("surfaces auth failures as reconnect-needed", async () => {
    const r = await executeRun(exec({ credentials: { scenario: "auth_failed" } }), deps);
    expect(r).toMatchObject({ status: "failed", needsReconnect: true });
  });
});
