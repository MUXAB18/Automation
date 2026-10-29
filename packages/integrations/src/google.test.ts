import { describe, expect, it, vi } from "vitest";
import { listGa4Properties, runGa4Report } from "./google-analytics";
import { refreshAccessToken } from "./google-auth";
import { GoogleApiError, GoogleReauthRequiredError, fetchWithRetry } from "./google-http";
import { listGscSites, querySearchAnalytics } from "./google-search-console";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const fast = { sleep: async () => {}, baseDelayMs: 1 };

describe("fetchWithRetry", () => {
  it("retries 429 and 5xx then succeeds", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({}, 429))
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValue(json({ ok: 1 }));
    const res = await fetchWithRetry("https://x", {}, { ...fast, fetch: f });
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("honours Retry-After", async () => {
    const sleep = vi.fn(async () => {});
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({}, 429, { "retry-after": "2" }))
      .mockResolvedValue(json({}));
    await fetchWithRetry("https://x", {}, { fetch: f, sleep });
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("does not retry 4xx and gives up after maxAttempts", async () => {
    const f404 = vi.fn().mockResolvedValue(json({}, 404));
    expect((await fetchWithRetry("https://x", {}, { ...fast, fetch: f404 })).status).toBe(404);
    expect(f404).toHaveBeenCalledTimes(1);

    const f500 = vi.fn().mockResolvedValue(json({}, 500));
    expect(
      (await fetchWithRetry("https://x", {}, { ...fast, fetch: f500, maxAttempts: 3 })).status,
    ).toBe(500);
    expect(f500).toHaveBeenCalledTimes(3);
  });

  it("retries network errors, then rethrows", async () => {
    const f = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(
      fetchWithRetry("https://x", {}, { ...fast, fetch: f, maxAttempts: 2 }),
    ).rejects.toThrow("boom");
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("refreshAccessToken", () => {
  const creds = { clientId: "id", clientSecret: "shh-secret", refreshToken: "rt-secret" };

  it("returns the token with an early expiry and posts form-encoded credentials", async () => {
    const f = vi.fn().mockResolvedValue(json({ access_token: "at", expires_in: 3600 }));
    const now = new Date("2026-01-01T00:00:00Z");
    const token = await refreshAccessToken(creds, { fetch: f, now: () => now, ...fast });
    expect(token.accessToken).toBe("at");
    expect(token.expiresAt.getTime()).toBe(now.getTime() + 3540_000);
    const init = f.mock.calls[0]?.[1] as RequestInit;
    expect(String(init.body)).toContain("grant_type=refresh_token");
  });

  it("maps invalid_grant to GoogleReauthRequiredError", async () => {
    const f = vi.fn().mockResolvedValue(json({ error: "invalid_grant" }, 400));
    await expect(refreshAccessToken(creds, { fetch: f, ...fast })).rejects.toThrow(
      GoogleReauthRequiredError,
    );
  });

  it("does not leak secrets in other failures", async () => {
    const f = vi.fn().mockResolvedValue(json({ error: "invalid_client" }, 401));
    const error = await refreshAccessToken(creds, { fetch: f, ...fast }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoogleApiError);
    expect(String((error as Error).message)).not.toMatch(/secret/);
  });
});

describe("Search Console client", () => {
  it("lists sites", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(
        json({
          siteEntry: [{ siteUrl: "sc-domain:sarjworldwide.ca", permissionLevel: "siteOwner" }],
        }),
      );
    expect(await listGscSites("at", { fetch: f })).toEqual([
      { siteUrl: "sc-domain:sarjworldwide.ca", permissionLevel: "siteOwner" },
    ]);
    expect((f.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({
      authorization: "Bearer at",
    });
  });

  it("maps keys to named dimensions and encodes the site url", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(
        json({
          rows: [
            {
              keys: ["2026-01-01", "seo ottawa"],
              clicks: 3,
              impressions: 40,
              ctr: 0.075,
              position: 8.2,
            },
          ],
        }),
      );
    const rows = await querySearchAnalytics(
      "at",
      {
        siteUrl: "sc-domain:sarjworldwide.ca",
        startDate: "2026-01-01",
        endDate: "2026-01-01",
        dimensions: ["date", "query"],
      },
      { fetch: f },
    );
    expect(rows).toEqual([
      {
        dimensions: { date: "2026-01-01", query: "seo ottawa" },
        clicks: 3,
        impressions: 40,
        ctr: 0.075,
        position: 8.2,
      },
    ]);
    expect(String(f.mock.calls[0]?.[0])).toContain(
      "sites/sc-domain%3Asarjworldwide.ca/searchAnalytics/query",
    );
  });

  it("pages until a short page and respects maxRows", async () => {
    const full = Array.from({ length: 25_000 }, (_, i) => ({
      keys: [`q${i}`],
      clicks: 1,
      impressions: 1,
      ctr: 1,
      position: 1,
    }));
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({ rows: full }))
      .mockResolvedValueOnce(json({ rows: full.slice(0, 5) }));
    const rows = await querySearchAnalytics(
      "at",
      {
        siteUrl: "https://a.com/",
        startDate: "2026-01-01",
        endDate: "2026-01-02",
        dimensions: ["query"],
      },
      { fetch: f },
    );
    expect(rows).toHaveLength(25_005);
    expect(JSON.parse(String((f.mock.calls[1]?.[1] as RequestInit).body)).startRow).toBe(25_000);

    const capped = vi.fn().mockResolvedValue(json({ rows: full }));
    const few = await querySearchAnalytics(
      "at",
      {
        siteUrl: "https://a.com/",
        startDate: "2026-01-01",
        endDate: "2026-01-02",
        dimensions: ["query"],
        maxRows: 25_000,
      },
      { fetch: capped },
    );
    expect(few).toHaveLength(25_000);
    expect(capped).toHaveBeenCalledTimes(1);
  });

  it("surfaces API errors with status", async () => {
    const f = vi.fn().mockResolvedValue(json({ error: { message: "forbidden" } }, 403));
    await expect(listGscSites("at", { fetch: f })).rejects.toMatchObject({
      status: 403,
      name: "GoogleApiError",
    });
  });

  it("rejects unexpected response shapes", async () => {
    const f = vi.fn().mockResolvedValue(json({ rows: [{ keys: [], clicks: "many" }] }));
    await expect(
      querySearchAnalytics(
        "at",
        {
          siteUrl: "https://a.com/",
          startDate: "2026-01-01",
          endDate: "2026-01-01",
          dimensions: [],
        },
        { fetch: f },
      ),
    ).rejects.toThrow();
  });
});

describe("GA4 client", () => {
  it("flattens account summaries into properties", async () => {
    const f = vi.fn().mockResolvedValue(
      json({
        accountSummaries: [
          {
            displayName: "SARJ",
            propertySummaries: [{ property: "properties/12345", displayName: "SARJ Web" }],
          },
        ],
      }),
    );
    expect(await listGa4Properties("at", { fetch: f })).toEqual([
      { propertyId: "12345", displayName: "SARJ Web", accountName: "SARJ" },
    ]);
  });

  it("follows account summary pagination", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({ accountSummaries: [], nextPageToken: "t2" }))
      .mockResolvedValueOnce(json({ accountSummaries: [] }));
    await listGa4Properties("at", { fetch: f });
    expect(String(f.mock.calls[1]?.[0])).toContain("pageToken=t2");
  });

  it("converts report rows to named dimensions and numeric metrics", async () => {
    const f = vi.fn().mockResolvedValue(
      json({
        rows: [
          {
            dimensionValues: [{ value: "20260101" }, { value: "Organic Search" }],
            metricValues: [{ value: "12" }, { value: "9" }],
          },
        ],
      }),
    );
    const rows = await runGa4Report(
      "at",
      {
        propertyId: "12345",
        startDate: "2026-01-01",
        endDate: "2026-01-01",
        dimensions: ["date", "sessionDefaultChannelGroup"],
        metrics: ["sessions", "totalUsers"],
      },
      { fetch: f },
    );
    expect(rows).toEqual([
      {
        dimensions: { date: "20260101", sessionDefaultChannelGroup: "Organic Search" },
        metrics: { sessions: 12, totalUsers: 9 },
      },
    ]);
    expect(String(f.mock.calls[0]?.[0])).toContain("properties/12345:runReport");
  });

  it("rejects a non-numeric property id before calling Google", async () => {
    const f = vi.fn();
    await expect(
      runGa4Report(
        "at",
        { propertyId: "1/../x", startDate: "a", endDate: "b", dimensions: [], metrics: [] },
        { fetch: f },
      ),
    ).rejects.toThrow(/numeric/);
    expect(f).not.toHaveBeenCalled();
  });
});
