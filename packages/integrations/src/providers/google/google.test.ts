import { createVerify, generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "../../framework/rate-limiter";
import { runSync } from "../../framework/runner";
import type { NormalizedRecord, SyncSink } from "../../framework/types";
import {
  buildGoogleInstallUrl,
  clearGoogleTokenCache,
  exchangeGoogleCode,
  getGoogleAccessToken,
  parseServiceAccountKey,
  signServiceAccountAssertion,
} from "./auth";
import { GA4_SCOPE, GSC_SCOPE, type GoogleOAuthConfig, type GoogleSettings } from "./config";
import { createGa4Adapter } from "./ga4";
import { createSearchConsoleAdapter } from "./gsc";
import { createGoogleMockAdapter } from "./mock";

const oauth: GoogleOAuthConfig = {
  clientId: "cid",
  clientSecret: "csecret",
  redirectUri: "https://app.test/cb",
};
const TODAY = new Date("2026-04-10T12:00:00Z");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

type Call = { url: URL; method: string; body: unknown; headers: Record<string, string> };
function api(handler: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: URL | string, init: RequestInit = {}) => {
    const c: Call = {
      url: new URL(String(input)),
      method: init.method ?? "GET",
      headers: (init.headers ?? {}) as Record<string, string>,
      body:
        typeof init.body === "string" &&
        init.headers &&
        (init.headers as Record<string, string>)["content-type"] === "application/json"
          ? JSON.parse(init.body)
          : init.body,
    };
    calls.push(c);
    return handler(c);
  });
  return { calls, fetch: fetchMock as unknown as typeof fetch };
}
const token = (over = {}) => json({ access_token: "access-1", expires_in: 3600, ...over });
const isToken = (c: Call) => c.url.hostname === "oauth2.googleapis.com";
const refresh = { kind: "oauth", refreshToken: "refresh-secret", scope: "" } as const;
const settings = (...ids: string[]): GoogleSettings => ({
  sources: ids.map((externalId) => ({ externalId, dataThrough: null })),
});

beforeEach(() => clearGoogleTokenCache());

describe("authentication", () => {
  it("builds an offline consent URL with state", () => {
    const u = new URL(buildGoogleInstallUrl(oauth, GA4_SCOPE, "st"));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      client_id: "cid",
      response_type: "code",
      scope: GA4_SCOPE,
      access_type: "offline",
      prompt: "consent",
      state: "st",
    });
  });

  it("exchanges a code and insists on a refresh token", async () => {
    const ok = api(() => token({ refresh_token: "r-1", scope: GA4_SCOPE }));
    expect(await exchangeGoogleCode(oauth, "code", { fetch: ok.fetch })).toEqual({
      refreshToken: "r-1",
      scope: GA4_SCOPE,
    });
    expect(String(ok.calls[0]!.body)).toContain("grant_type=authorization_code");
    await expect(
      exchangeGoogleCode(oauth, "code", { fetch: api(() => token()).fetch }),
    ).rejects.toThrow(/refresh token/);
    await expect(
      exchangeGoogleCode(oauth, "code", {
        fetch: api(() => json({ error: "invalid_grant" }, 400)).fetch,
      }),
    ).rejects.toMatchObject({ code: "auth_failed", needsReconnect: true });
  });

  it("refreshes with the refresh token, caches the access token, and maps a revoked grant to reconnect", async () => {
    const { calls, fetch } = api(() => token());
    expect(await getGoogleAccessToken(refresh, GA4_SCOPE, oauth, { fetch })).toBe("access-1");
    await getGoogleAccessToken(refresh, GA4_SCOPE, oauth, { fetch });
    expect(calls).toHaveLength(1);
    expect(String(calls[0]!.body)).toContain("grant_type=refresh_token");
    clearGoogleTokenCache();
    await expect(
      getGoogleAccessToken(refresh, GA4_SCOPE, oauth, {
        fetch: api(() => json({ error: "invalid_grant" }, 400)).fetch,
      }),
    ).rejects.toMatchObject({ code: "auth_failed", needsReconnect: true });
    clearGoogleTokenCache();
    await expect(getGoogleAccessToken(refresh, GA4_SCOPE, null, { fetch })).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("signs a verifiable RS256 service-account assertion with a one-hour lifetime", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const jwt = signServiceAccountAssertion(
      { clientEmail: "sa@proj.iam.gserviceaccount.com", privateKey: pem },
      GSC_SCOPE,
      1_700_000_000_000,
    );
    const [h, c, sig] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(c!, "base64url").toString())).toEqual({
      iss: "sa@proj.iam.gserviceaccount.com",
      scope: GSC_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    expect(
      createVerify("RSA-SHA256")
        .update(`${h}.${c}`)
        .verify(publicKey, Buffer.from(sig!, "base64url")),
    ).toBe(true);

    const { calls, fetch } = api(() => token());
    await getGoogleAccessToken(
      { kind: "service_account", clientEmail: "sa@proj.iam.gserviceaccount.com", privateKey: pem },
      GSC_SCOPE,
      null,
      { fetch },
    );
    expect(String(calls[0]!.body)).toContain("jwt-bearer");
  });

  it("validates a pasted service-account key and keeps only what is needed", () => {
    const key = JSON.stringify({
      type: "service_account",
      client_email: "sa@p.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
      project_id: "x",
      private_key_id: "y",
    });
    expect(parseServiceAccountKey(key)).toEqual({
      clientEmail: "sa@p.iam.gserviceaccount.com",
      privateKey: expect.stringContaining("BEGIN PRIVATE KEY"),
    });
    expect(() => parseServiceAccountKey("not json")).toThrow(/JSON/);
    expect(() => parseServiceAccountKey("{}")).toThrow(/service account/);
  });
});

describe("API calls and errors", () => {
  const ga4 = (handler: (c: Call) => Response | Promise<Response>) => {
    const a = api((c) => (isToken(c) ? token() : handler(c)));
    return { ...a, adapter: createGa4Adapter(oauth, { fetch: a.fetch, today: () => TODAY }) };
  };
  const page = (
    adapter: ReturnType<typeof createGa4Adapter>,
    resource: string,
    s: GoogleSettings = settings("123"),
    cursor: string | null = null,
  ) =>
    adapter.fetchPage(
      refresh,
      { resource, cursor, since: null },
      { accountId: "a", clientId: "c", settings: s },
    );

  it("retries once with a fresh token after a 401 and never leaks secrets in errors", async () => {
    let n = 0;
    const { adapter, calls } = ga4(() =>
      ++n === 1 ? json({}, 401) : json({ accountSummaries: [] }),
    );
    await expect(
      adapter.testConnection(refresh, { accountId: "a", clientId: "c" }),
    ).resolves.toMatchObject({ ok: true });
    expect(calls.filter(isToken)).toHaveLength(2);
    const bad = ga4(() =>
      json({ error: { message: "refresh-secret leaked?", status: "PERMISSION_DENIED" } }, 403),
    );
    const err = await page(bad.adapter, "properties").catch((e: Error) => e);
    expect(JSON.stringify(err)).not.toContain("refresh-secret");
  });

  it("separates a disabled API, quota exhaustion and plain rate limits", async () => {
    const t = async (status: number, body: unknown) =>
      page(ga4(() => json(body, status)).adapter, "ga4_totals").catch(
        (e: { code: string; retryAfterMs?: number; retryable: boolean }) => e,
      );
    expect(await t(403, { error: { errors: [{ reason: "accessNotConfigured" }] } })).toMatchObject({
      code: "invalid_request",
    });
    expect(
      await t(429, {
        error: {
          status: "RESOURCE_EXHAUSTED",
          message: "Exhausted property tokens for a project per day",
        },
      }),
    ).toMatchObject({ code: "quota_exhausted", retryAfterMs: 3_600_000, retryable: true });
    expect(
      await t(429, {
        error: {
          status: "RESOURCE_EXHAUSTED",
          message: "Exhausted property tokens for a project per hour",
        },
      }),
    ).toMatchObject({ code: "quota_exhausted", retryAfterMs: 900_000 });
    expect(await t(429, {})).toMatchObject({ code: "rate_limited" });
    expect(await t(401, {})).toMatchObject({ code: "auth_failed", needsReconnect: true });
  });
});

describe("Google Analytics 4 adapter", () => {
  const rowFor = (day: string, vals: string[]) => ({
    dimensionValues: [{ value: day }],
    metricValues: vals.map((value) => ({ value })),
  });
  const make = (handler: (c: Call) => Response | Promise<Response>) => {
    const a = api((c) => (isToken(c) ? token() : handler(c)));
    return { ...a, adapter: createGa4Adapter(oauth, { fetch: a.fetch, today: () => TODAY }) };
  };
  const walk = async (
    adapter: ReturnType<typeof createGa4Adapter>,
    resource: string,
    s: GoogleSettings,
  ) => {
    const records: NormalizedRecord[] = [];
    let cursor: string | null = null;
    do {
      const p = await adapter.fetchPage(
        refresh,
        { resource, cursor, since: null },
        { accountId: "a", clientId: "c", settings: s },
      );
      records.push(...adapter.normalize(resource, p.items, { accountId: "a", clientId: "c" }));
      cursor = p.nextCursor;
    } while (cursor);
    return records;
  };

  it("lists every property across pages", async () => {
    const { adapter, calls } = make((c) =>
      c.url.searchParams.get("pageToken")
        ? json({
            accountSummaries: [
              {
                displayName: "B",
                propertySummaries: [{ property: "properties/2", displayName: "Two" }],
              },
            ],
          })
        : json({
            accountSummaries: [
              {
                displayName: "A",
                propertySummaries: [
                  {
                    property: "properties/1",
                    displayName: "One",
                    propertyType: "PROPERTY_TYPE_ORDINARY",
                  },
                ],
              },
            ],
            nextPageToken: "n",
          }),
    );
    const p = await adapter.fetchPage(
      refresh,
      { resource: "properties", cursor: null, since: null },
      { accountId: "a", clientId: "c" },
    );
    expect(
      adapter
        .normalize("properties", p.items, { accountId: "a", clientId: "c" })
        .map((r) => [r.externalId, r.data.displayName]),
    ).toEqual([
      ["1", "One"],
      ["2", "Two"],
    ]);
    expect(calls.filter((c) => !isToken(c))).toHaveLength(2);
  });

  it("backfills 90 days in 30-day windows through yesterday and stores one record per day with all metrics", async () => {
    const { adapter, calls } = make((c) => {
      const range = (c.body as { dateRanges: { startDate: string; endDate: string }[] })
        .dateRanges[0]!;
      return json({
        rows: [
          rowFor(range.startDate.replaceAll("-", ""), [
            "100",
            "80",
            "40",
            "60",
            "0.6",
            "75.5",
            "0.4",
            "190",
            "3",
          ]),
        ],
        propertyQuota: { tokensPerHour: { consumed: 10, remaining: 39990 } },
      });
    });
    const records = await walk(adapter, "ga4_totals", settings("123"));
    const reports = calls.filter((c) => !isToken(c));
    expect(
      reports.map(
        (c) => (c.body as { dateRanges: { startDate: string; endDate: string }[] }).dateRanges[0],
      ),
    ).toEqual([
      { startDate: "2026-01-10", endDate: "2026-02-08" },
      { startDate: "2026-02-09", endDate: "2026-03-10" },
      { startDate: "2026-03-11", endDate: "2026-04-09" },
    ]);
    expect(reports[0]!.url.pathname).toBe("/v1beta/properties/123:runReport");
    expect(reports[0]!.headers.authorization).toBe("Bearer access-1");
    expect(
      (reports[0]!.body as { metrics: { name: string }[] }).metrics.map((m) => m.name),
    ).toContain("keyEvents");
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({
      resource: "metrics",
      source: "live",
      data: {
        kind: "ga4",
        set: "totals",
        day: "2026-01-10",
        isFinal: true,
        values: {
          "ga4.sessions": 100,
          "ga4.total_users": 80,
          "ga4.engagement_rate": 0.6,
          "ga4.key_events": 3,
          "ga4.page_views": 190,
        },
      },
    });
  });

  it("continues from the stored day with an overlap, and marks the newest days provisional", async () => {
    const { adapter } = make((c) => {
      const r = (c.body as { dateRanges: { startDate: string }[] }).dateRanges[0]!;
      return json({
        rows: [
          rowFor("20260407", ["1", "1", "1", "1", "1", "1", "1", "1", "1"]),
          rowFor("20260409", ["2", "2", "2", "2", "2", "2", "2", "2", "2"]),
        ],
        _from: r.startDate,
      });
    });
    const recs = await walk(adapter, "ga4_totals", {
      sources: [{ externalId: "123", dataThrough: "2026-04-06" }],
    });
    expect(recs.map((r) => [r.data.day, r.data.isFinal])).toEqual([
      ["2026-04-07", true],
      ["2026-04-09", false],
    ]);
  });

  it("reads breakdowns, skips Google's '(other)' bucket, and takes the top 500 landing pages per day", async () => {
    const { adapter, calls } = make((c) => {
      const b = c.body as { dimensions: { name: string }[] };
      return b.dimensions[0]!.name === "date"
        ? json({
            rows: [
              {
                dimensionValues: [{ value: "20260409" }, { value: "Organic Search" }],
                metricValues: [{ value: "5" }, { value: "3" }, { value: "1" }],
              },
              {
                dimensionValues: [{ value: "20260409" }, { value: "(other)" }],
                metricValues: [{ value: "9" }, { value: "9" }, { value: "9" }],
              },
            ],
          })
        : json({
            rows: [
              {
                dimensionValues: [{ value: "/pricing" }],
                metricValues: [{ value: "7" }, { value: "4" }, { value: "2" }],
              },
            ],
          });
    });
    const ch = await walk(adapter, "ga4_channels", {
      sources: [{ externalId: "123", dataThrough: "2026-04-07" }],
    });
    expect(ch).toHaveLength(1);
    expect(ch[0]!.data).toMatchObject({
      set: "channel",
      dimensions: { channel: "Organic Search" },
      values: { "ga4.sessions": 5, "ga4.engaged_sessions": 3 },
    });
    const lp = await walk(adapter, "ga4_landing_pages", {
      sources: [{ externalId: "123", dataThrough: "2026-04-07" }],
    });
    const body = calls
      .filter((c) => !isToken(c) && (c.body as { limit?: number }).limit === 500)
      .at(-1)!.body as {
      orderBys: unknown[];
      dateRanges: { startDate: string; endDate: string }[];
    };
    expect(body.dateRanges[0]!.startDate).toBe(body.dateRanges[0]!.endDate);
    expect(body.orderBys).toEqual([{ metric: { metricName: "sessions" }, desc: true }]);
    expect(
      lp.every(
        (r) => r.data.dimensions && (r.data.dimensions as { page: string }).page === "/pricing",
      ),
    ).toBe(true);
    expect(new Set(lp.map((r) => r.data.day)).size).toBe(lp.length);
  });

  it("reports a property the account cannot read as a problem on that property and still reads the others", async () => {
    const { adapter } = make((c) =>
      c.url.pathname.includes("/properties/111:")
        ? json({ error: { status: "PERMISSION_DENIED" } }, 403)
        : json({ rows: [rowFor("20260409", ["1", "1", "1", "1", "1", "1", "1", "1", "1"])] }),
    );
    const recs = await walk(adapter, "ga4_totals", {
      sources: [
        { externalId: "111", dataThrough: "2026-04-07" },
        { externalId: "222", dataThrough: "2026-04-07" },
      ],
    });
    expect(recs.find((r) => r.resource === "source_problem")).toMatchObject({
      externalId: "111",
      data: { code: "access_denied", kind: "ga4" },
    });
    expect(recs.some((r) => r.resource === "metrics" && r.data.sourceKey === "222")).toBe(true);
  });

  it("stops before the property runs out of hourly tokens", async () => {
    const { adapter } = make(() =>
      json({
        rows: [rowFor("20260409", ["1", "1", "1", "1", "1", "1", "1", "1", "1"])],
        propertyQuota: { tokensPerHour: { remaining: 500 } },
      }),
    );
    await expect(walk(adapter, "ga4_totals", settings("123"))).rejects.toMatchObject({
      code: "quota_exhausted",
      retryable: true,
    });
  });
});

describe("Search Console adapter", () => {
  const make = (handler: (c: Call) => Response | Promise<Response>) => {
    const a = api((c) => (isToken(c) ? token() : handler(c)));
    return {
      ...a,
      adapter: createSearchConsoleAdapter(oauth, { fetch: a.fetch, today: () => TODAY }),
    };
  };
  const row = (keys: string[], clicks = 10) => ({
    keys,
    clicks,
    impressions: 200,
    ctr: clicks / 200,
    position: 6.4,
  });

  it("lists sites with their permission level, and normalises them as properties", async () => {
    const { adapter } = make(() =>
      json({
        siteEntry: [
          { siteUrl: "sc-domain:acme.ca", permissionLevel: "siteOwner" },
          { siteUrl: "https://acme.ca/", permissionLevel: "siteUnverifiedUser" },
        ],
      }),
    );
    const p = await adapter.fetchPage(
      refresh,
      { resource: "properties", cursor: null, since: null },
      { accountId: "a", clientId: "c" },
    );
    const recs = adapter.normalize("properties", p.items, { accountId: "a", clientId: "c" });
    expect(recs.map((r) => [r.externalId, r.data.propertyType, r.data.permissionLevel])).toEqual([
      ["sc-domain:acme.ca", "domain", "siteOwner"],
      ["https://acme.ca/", "url_prefix", "siteUnverifiedUser"],
    ]);
  });

  it("queries daily totals with final data only, encodes the site URL, and stores the four metrics as reported", async () => {
    const { adapter, calls } = make(() =>
      json({ rows: [row(["2026-04-08"], 12), row(["2026-04-09"], 15)] }),
    );
    const s: GoogleSettings = {
      sources: [{ externalId: "sc-domain:acme.ca", dataThrough: "2026-04-05" }],
    };
    const p = await adapter.fetchPage(
      refresh,
      { resource: "gsc_totals", cursor: null, since: null },
      { accountId: "a", clientId: "c", settings: s },
    );
    const call = calls.find((c) => !isToken(c))!;
    expect(call.url.pathname).toBe(
      "/webmasters/v3/sites/sc-domain%3Aacme.ca/searchAnalytics/query",
    );
    expect(call.body).toMatchObject({
      startDate: "2026-04-02",
      endDate: "2026-04-09",
      dimensions: ["date"],
      dataState: "final",
      rowLimit: 25000,
    });
    const recs = adapter.normalize("gsc_totals", p.items, { accountId: "a", clientId: "c" });
    expect(recs[0]!.data).toMatchObject({
      kind: "search_console",
      day: "2026-04-08",
      isFinal: true,
      values: { "gsc.clicks": 12, "gsc.impressions": 200, "gsc.ctr": 0.06, "gsc.position": 6.4 },
    });
  });

  it("reads top pages and queries one day at a time (500 rows), with the day coming from the request", async () => {
    const { adapter, calls } = make((c) =>
      json({
        rows: [
          row([
            (c.body as { dimensions: string[] }).dimensions[0] === "page"
              ? "https://acme.ca/a"
              : "freight quote",
          ]),
        ],
      }),
    );
    const s: GoogleSettings = {
      sources: [{ externalId: "sc-domain:acme.ca", dataThrough: "2026-04-07" }],
    };
    const walk = async (resource: string) => {
      const out: NormalizedRecord[] = [];
      let cursor: string | null = null;
      do {
        const p = await adapter.fetchPage(
          refresh,
          { resource, cursor, since: null },
          { accountId: "a", clientId: "c", settings: s },
        );
        out.push(...adapter.normalize(resource, p.items, { accountId: "a", clientId: "c" }));
        cursor = p.nextCursor;
      } while (cursor);
      return out;
    };
    const pages = await walk("gsc_pages");
    const queries = await walk("gsc_queries");
    expect(pages.map((r) => r.data.day)).toEqual([
      "2026-04-04",
      "2026-04-05",
      "2026-04-06",
      "2026-04-07",
      "2026-04-08",
      "2026-04-09",
    ]);
    expect(pages[0]!.data.dimensions).toEqual({ page: "https://acme.ca/a" });
    expect(queries[0]!.data.dimensions).toEqual({ query: "freight quote" });
    expect(
      calls
        .filter((c) => !isToken(c))
        .every(
          (c) =>
            (c.body as { rowLimit: number; startDate: string; endDate: string }).rowLimit === 500 &&
            (c.body as { startDate: string }).startDate === (c.body as { endDate: string }).endDate,
        ),
    ).toBe(true);
  });

  it("handles empty results, devices, and a site the account cannot read", async () => {
    const empty = make(() => json({}));
    const p = await empty.adapter.fetchPage(
      refresh,
      { resource: "gsc_devices", cursor: null, since: null },
      {
        accountId: "a",
        clientId: "c",
        settings: { sources: [{ externalId: "sc-domain:a.ca", dataThrough: "2026-04-08" }] },
      },
    );
    expect(p.items).toEqual([]);
    const denied = make(() => json({ error: { status: "PERMISSION_DENIED" } }, 403));
    const d = await denied.adapter.fetchPage(
      refresh,
      { resource: "gsc_totals", cursor: null, since: null },
      { accountId: "a", clientId: "c", settings: settings("sc-domain:a.ca") },
    );
    expect(
      denied.adapter.normalize("gsc_totals", d.items, { accountId: "a", clientId: "c" })[0],
    ).toMatchObject({ resource: "source_problem", data: { code: "access_denied" } });
  });
});

describe("development mock through the shared pipeline", () => {
  const run = (
    kind: "ga4" | "search_console",
    scenario: string,
    s: GoogleSettings,
    resources?: string[],
  ) => {
    const adapter = createGoogleMockAdapter(kind);
    const rows: NormalizedRecord[] = [];
    const sink: SyncSink = { write: async (r) => (rows.push(...r), r.length) };
    return runSync({
      adapter,
      credentials: { scenario },
      ctx: { accountId: "a", clientId: "c", settings: s },
      sink,
      limiter: new RateLimiter({ perSecond: 10_000, burst: 10_000 }),
      resources,
      clock: { now: () => 0, sleep: async () => {} },
    }).then((outcome) => ({ outcome, rows }));
  };

  it("discovers a mock property, then produces metrics only for selected ones, all tagged mock", async () => {
    const first = await run("ga4", "healthy", { sources: [] });
    expect(first.rows.filter((r) => r.resource === "properties")).toHaveLength(1);
    expect(first.rows.some((r) => r.resource === "metrics")).toBe(false);
    const second = await run("ga4", "healthy", settings("100200300"));
    const metrics = second.rows.filter((r) => r.resource === "metrics");
    expect(second.outcome).toMatchObject({ status: "succeeded", source: "mock" });
    expect(metrics.length).toBeGreaterThan(300);
    expect(second.rows.every((r) => r.source === "mock")).toBe(true);
    expect(new Set(metrics.map((r) => r.data.set))).toEqual(
      new Set(["totals", "channel", "landing_page"]),
    );
    // deterministic: the same run gives the same numbers
    const again = await run("ga4", "healthy", settings("100200300"), ["ga4_totals"]);
    expect(again.rows.find((r) => r.externalId === metrics[0]!.externalId)?.data).toEqual(
      metrics[0]!.data,
    );
  });

  it("produces search metrics with consistent CTR, and exercises failure scenarios", async () => {
    const { rows } = await run("search_console", "healthy", settings("sc-domain:mock.example"), [
      "gsc_totals",
    ]);
    const v = rows[0]!.data.values as Record<string, number>;
    expect(v["gsc.ctr"]).toBeCloseTo(v["gsc.clicks"]! / v["gsc.impressions"]!, 6);
    expect((await run("ga4", "auth_failed", settings("100200300"))).outcome).toMatchObject({
      status: "failed",
      needsReconnect: true,
    });
    const denied = await run("search_console", "access_denied", settings("sc-domain:mock.example"));
    expect(denied.outcome.errors).toEqual([]);
    expect(denied.rows.filter((r) => r.resource === "source_problem").length).toBeGreaterThan(0);
  });
});
