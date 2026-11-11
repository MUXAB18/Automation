import { describe, expect, it, vi } from "vitest";

import { createMlClient, MlServiceError } from "./ml-client";

const ok = {
  intents: [{ keyword: "buy shoes", intent: "transactional", confidence: 0.9 }],
  clusters: [{ label: "buy shoes", intent: "transactional", size: 1, keywords: ["buy shoes"] }],
  model: {
    version: "v1",
    trained_at: "2026-01-01T00:00:00+00:00",
    accuracy: 0.9,
    training_examples: 10,
  },
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("ml client", () => {
  it("sends a deduplicated batch with the bearer token and validates the answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(ok));
    const client = createMlClient({
      baseUrl: "http://ml:8001/",
      token: "secret",
      fetch: fetchMock,
    });
    const result = await client.analyzeKeywords([" buy shoes ", "buy shoes", ""]);
    expect(result.clusters[0]?.intent).toBe("transactional");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://ml:8001/v1/keywords/analyze");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret");
    expect(JSON.parse(init.body as string).keywords).toEqual(["buy shoes"]);
  });

  it("rejects empty input and oversized batches without calling the service", async () => {
    const fetchMock = vi.fn();
    const client = createMlClient({ baseUrl: "http://ml", token: "t", fetch: fetchMock });
    await expect(client.analyzeKeywords([" "])).rejects.toBeInstanceOf(MlServiceError);
    await expect(
      client.analyzeKeywords(Array.from({ length: 1001 }, (_, i) => `k${i}`)),
    ).rejects.toThrow(/at most/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps http errors, bad payloads and network failures to MlServiceError", async () => {
    const make = (impl: () => Promise<Response>) =>
      createMlClient({ baseUrl: "http://ml", token: "t", fetch: vi.fn(impl) });
    await expect(make(async () => json({}, 401)).analyzeKeywords(["a"])).rejects.toMatchObject({
      status: 401,
    });
    await expect(make(async () => json({ nope: true })).analyzeKeywords(["a"])).rejects.toThrow(
      /unexpected/,
    );
    await expect(
      make(async () => {
        throw new Error("ECONNREFUSED");
      }).analyzeKeywords(["a"]),
    ).rejects.toThrow(/unreachable/);
  });

  it("reports health as a boolean", async () => {
    expect(
      await createMlClient({
        baseUrl: "http://ml",
        token: "t",
        fetch: vi.fn().mockResolvedValue(json({})),
      }).health(),
    ).toBe(true);
    expect(
      await createMlClient({
        baseUrl: "http://ml",
        token: "t",
        fetch: vi.fn().mockRejectedValue(new Error("x")),
      }).health(),
    ).toBe(false);
  });
});
