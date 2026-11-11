import { describe, expect, it, vi } from "vitest";
import {
  AdapterRegistry,
  ProviderError,
  errorFromStatus,
  type ProviderAdapter,
} from "@automation/integrations";
import type { PublishExecution } from "@automation/db";
import { executePublish, outcomeFromError } from "./publish-dispatch";

const job = (over: Partial<PublishExecution> = {}): PublishExecution => ({
  jobId: "j1",
  clientId: "c",
  agencyId: "g",
  accountId: "a",
  providerKey: "gohighlevel",
  isMock: false,
  accountStatus: "active",
  scopes: [],
  attempts: 1,
  text: "Hello",
  targetAccountIds: ["fb1"],
  credentials: { accessToken: "t" },
  ...over,
});

function registryWith(publish: ProviderAdapter["publishPost"]) {
  const registry = new AdapterRegistry();
  const base = registry.get("gohighlevel", "mock");
  registry.registerLive({ ...base, isMock: false, publishPost: publish });
  return registry;
}

describe("outcomeFromError", () => {
  it("never retries an unclear failure, and re-queues only waiting-room errors", () => {
    expect(outcomeFromError(errorFromStatus(503))).toMatchObject({ kind: "unknown" });
    expect(outcomeFromError(new ProviderError("timeout", "slow"))).toMatchObject({
      kind: "unknown",
    });
    expect(outcomeFromError(new ProviderError("invalid_response", "odd"))).toMatchObject({
      kind: "unknown",
    });
    expect(outcomeFromError(errorFromStatus(429, 2))).toEqual({
      kind: "rejected",
      message: expect.any(String),
      retryAfterMs: 2000,
    });
    expect(outcomeFromError(errorFromStatus(422))).toEqual({
      kind: "rejected",
      message: expect.any(String),
      retryAfterMs: undefined,
    });
    expect(outcomeFromError(errorFromStatus(401))).toMatchObject({
      kind: "rejected",
      retryAfterMs: undefined,
    });
  });
});

describe("executePublish", () => {
  it("stamps the request as sent BEFORE calling the provider", async () => {
    const order: string[] = [];
    const registry = registryWith(
      async () => (order.push("provider"), { externalPostId: "p1", providerStatus: "published" }),
    );
    const out = await executePublish(job(), {
      registry,
      publishingEnabled: true,
      markSent: async () => void order.push("marked"),
    });
    expect(order).toEqual(["marked", "provider"]);
    expect(out).toEqual({ kind: "accepted", externalPostId: "p1", providerStatus: "published" });
  });

  it("turns a 5xx after sending into an unknown outcome, and a validation error into a clean rejection", async () => {
    const unknown = await executePublish(job(), {
      registry: registryWith(async () => {
        throw errorFromStatus(502);
      }),
      publishingEnabled: true,
      markSent: async () => {},
    });
    expect(unknown.kind).toBe("unknown");
    const rejected = await executePublish(job(), {
      registry: registryWith(async () => {
        throw errorFromStatus(422);
      }),
      publishingEnabled: true,
      markSent: async () => {},
    });
    expect(rejected.kind).toBe("rejected");
  });

  it("sends nothing for mock accounts, inactive accounts, disabled publishing or a missing adapter", async () => {
    const publish = vi.fn(async () => ({ externalPostId: "x", providerStatus: "published" }));
    const markSent = vi.fn(async () => {});
    const registry = registryWith(publish);
    for (const [j, enabled] of [
      [job({ isMock: true }), true],
      [job({ accountStatus: "needs_reauth" }), true],
      [job(), false],
    ] as const) {
      expect(
        (await executePublish(j, { registry, publishingEnabled: enabled, markSent })).kind,
      ).toBe("rejected");
    }
    expect(
      (
        await executePublish(job(), {
          registry: new AdapterRegistry(),
          publishingEnabled: true,
          markSent,
        })
      ).kind,
    ).toBe("rejected");
    expect(publish).not.toHaveBeenCalled();
    expect(markSent).not.toHaveBeenCalled();
  });
});
