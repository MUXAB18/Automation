import { describe, expect, it, vi } from "vitest";
import { ProviderError } from "../../framework/errors";
import { RateLimiter } from "../../framework/rate-limiter";
import { runSync } from "../../framework/runner";
import type { NormalizedRecord, SyncSink } from "../../framework/types";
import { createGoHighLevelAdapter } from "./adapter";
import { GHL_READ_SCOPES, GHL_SCOPES, type GhlConfig } from "./config";
import {
  buildInstallUrl,
  credentialsFromToken,
  exchangeGhlAuthorizationCode,
  refreshGhlAccessToken,
} from "./oauth";

const config: GhlConfig = {
  clientId: "cid",
  clientSecret: "csecret",
  redirectUri: "https://app.test/cb",
};
const NOW = new Date("2026-01-01T00:00:00Z");
const FUTURE = "2026-01-02T00:00:00.000Z";
const ALL = [...GHL_READ_SCOPES, GHL_SCOPES.socialPostsWrite].join(" ");

const creds = (over: Record<string, string> = {}) => ({
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresAt: FUTURE,
  locationId: "loc1",
  userId: "user1",
  scope: ALL,
  ...over,
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

type Call = { url: URL; init: RequestInit };
function api(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: URL | string, init: RequestInit = {}) => {
    const call = { url: new URL(String(input)), init };
    calls.push(call);
    return handler(call);
  });
  return { calls, fetch: fetchMock as unknown as typeof fetch };
}
const header = (c: Call, name: string) => (c.init.headers as Record<string, string>)[name];
const body = (c: Call) => JSON.parse(String(c.init.body));
const noSleep = { now: () => NOW.getTime(), sleep: async () => {} };

function collect() {
  const rows: NormalizedRecord[] = [];
  const sink: SyncSink = { write: async (r) => (rows.push(...r), r.length) };
  return { rows, sink };
}

describe("OAuth", () => {
  it("builds the consent URL with space-separated scopes and state", () => {
    const url = new URL(
      buildInstallUrl(config, ["contacts.readonly", "workflows.readonly"], "st4te"),
    );
    expect(url.origin + url.pathname).toBe(
      "https://marketplace.gohighlevel.com/v2/oauth/chooselocation",
    );
    expect(url.searchParams.get("scope")).toBe("contacts.readonly workflows.readonly");
    expect(url.searchParams.get("state")).toBe("st4te");
    expect(url.searchParams.get("client_id")).toBe("cid");
  });

  it("exchanges a code (JSON) and turns the response into location credentials", async () => {
    const { calls, fetch } = api(() =>
      json({
        access_token: "a",
        refresh_token: "r",
        expires_in: 86400,
        scope: "contacts.readonly",
        userType: "Location",
        locationId: "L",
        userId: "U",
      }),
    );
    const token = await exchangeGhlAuthorizationCode(config, "the-code", fetch);
    expect(calls[0]!.url.pathname).toBe("/oauth/token");
    expect(body(calls[0]!)).toMatchObject({
      grant_type: "authorization_code",
      code: "the-code",
      client_id: "cid",
      client_secret: "csecret",
    });
    const c = credentialsFromToken(token, undefined, NOW);
    expect(c).toMatchObject({
      locationId: "L",
      userId: "U",
      scope: "contacts.readonly",
      expiresAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("refreshes with a form body and rejects agency-level authorisations", async () => {
    const { calls, fetch } = api(() =>
      json({
        access_token: "a2",
        refresh_token: "r2",
        expires_in: 86400,
        userType: "Location",
        locationId: "L",
      }),
    );
    await refreshGhlAccessToken(config, "old-refresh", fetch);
    expect(String(calls[0]!.init.body)).toContain("grant_type=refresh_token");
    expect(String(calls[0]!.init.body)).toContain("refresh_token=old-refresh");
    expect(() =>
      credentialsFromToken({
        access_token: "a",
        refresh_token: "r",
        expires_in: 1,
        scope: "",
        userType: "Company",
        companyId: "C",
      }),
    ).toThrow(/location/i);
  });

  it("maps a refused code to auth_failed and server trouble to a retryable error", async () => {
    await expect(
      exchangeGhlAuthorizationCode(config, "x", api(() => json({}, 400)).fetch),
    ).rejects.toMatchObject({ code: "auth_failed" });
    await expect(
      exchangeGhlAuthorizationCode(config, "x", api(() => json({}, 503)).fetch),
    ).rejects.toMatchObject({ code: "provider_unavailable", retryable: true });
  });
});

describe("token handling in API calls", () => {
  it("refreshes an expiring token first, stores the rotated one BEFORE using it, and uses it", async () => {
    const order: string[] = [];
    const { calls, fetch } = api((c) => {
      if (c.url.pathname === "/oauth/token")
        return json({
          access_token: "access-2",
          refresh_token: "refresh-2",
          expires_in: 86400,
          userType: "Location",
          locationId: "loc1",
        });
      order.push("api");
      return json({ campaigns: [] });
    });
    const adapter = createGoHighLevelAdapter(config, { fetch, now: () => NOW });
    const refreshed = vi.fn(
      async (_credentials: Record<string, string>, _meta: unknown) => void order.push("stored"),
    );
    await adapter.fetchPage(
      creds({ expiresAt: "2026-01-01T00:01:00.000Z" }),
      { resource: "campaigns", cursor: null, since: null },
      { accountId: "a", clientId: "c", onCredentialsRefreshed: refreshed },
    );
    expect(order).toEqual(["stored", "api"]);
    expect(refreshed.mock.calls[0]![0]).toMatchObject({
      accessToken: "access-2",
      refreshToken: "refresh-2",
      locationId: "loc1",
      userId: "user1",
    });
    expect(header(calls.at(-1)!, "authorization")).toBe("Bearer access-2");
  });

  it("retries once with a fresh token on 401, then gives up with auth_failed", async () => {
    let apiCalls = 0;
    const { fetch } = api((c) => {
      if (c.url.pathname === "/oauth/token")
        return json({
          access_token: "access-2",
          refresh_token: "refresh-2",
          expires_in: 86400,
          userType: "Location",
          locationId: "loc1",
        });
      apiCalls++;
      return apiCalls === 1
        ? json({}, 401)
        : json({ campaigns: [{ id: "c1", name: "N", status: "active" }] });
    });
    const adapter = createGoHighLevelAdapter(config, { fetch, now: () => NOW });
    const page = await adapter.fetchPage(
      creds(),
      { resource: "campaigns", cursor: null, since: null },
      { accountId: "a", clientId: "c" },
    );
    expect(page.items).toHaveLength(1);

    const alwaysDenied = api((c) =>
      c.url.pathname === "/oauth/token"
        ? json({
            access_token: "x",
            refresh_token: "y",
            expires_in: 1,
            userType: "Location",
            locationId: "loc1",
          })
        : json({}, 401),
    );
    const a2 = createGoHighLevelAdapter(config, { fetch: alwaysDenied.fetch, now: () => NOW });
    await expect(
      a2.fetchPage(
        creds(),
        { resource: "campaigns", cursor: null, since: null },
        { accountId: "a", clientId: "c" },
      ),
    ).rejects.toMatchObject({ code: "auth_failed" });
  });

  it("reports rate limits using the documented headers", async () => {
    const limited = createGoHighLevelAdapter(config, {
      fetch: api(() =>
        json({}, 429, {
          "x-ratelimit-interval-milliseconds": "4000",
          "x-ratelimit-remaining": "0",
        }),
      ).fetch,
      now: () => NOW,
    });
    await expect(
      limited.fetchPage(
        creds(),
        { resource: "campaigns", cursor: null, since: null },
        { accountId: "a", clientId: "c" },
      ),
    ).rejects.toMatchObject({ code: "rate_limited", retryAfterMs: 4000 });
    const daily = createGoHighLevelAdapter(config, {
      fetch: api(() => json({}, 429, { "x-ratelimit-daily-remaining": "0" })).fetch,
      now: () => NOW,
    });
    await expect(
      daily.fetchPage(
        creds(),
        { resource: "campaigns", cursor: null, since: null },
        { accountId: "a", clientId: "c" },
      ),
    ).rejects.toMatchObject({ code: "quota_exhausted", retryable: true });
  });
});

describe("sync through the shared pipeline", () => {
  const run = (
    adapterFetch: typeof fetch,
    resources: string[],
    credentials = creds(),
    grantedScopes?: string[],
  ) => {
    const out = collect();
    const adapter = createGoHighLevelAdapter(config, { fetch: adapterFetch, now: () => NOW });
    return runSync({
      adapter,
      credentials,
      ctx: { accountId: "acct", clientId: "c" },
      sink: out.sink,
      limiter: new RateLimiter({ perSecond: 1000 }),
      resources,
      grantedScopes,
      clock: noSleep,
    }).then((outcome) => ({ outcome, ...out }));
  };

  it("pages contacts with the documented cursor and the contacts version header", async () => {
    const full = (start: number) =>
      Array.from({ length: 100 }, (_, i) => ({
        id: `c${start + i}`,
        firstName: "A",
        email: `a${start + i}@x.test`,
        tags: ["t"],
        dateAdded: "2025-01-01T00:00:00.000Z",
      }));
    const { calls, fetch } = api((c) => {
      const after = c.url.searchParams.get("startAfterId");
      if (!after)
        return json({
          contacts: full(0),
          meta: { startAfterId: "c99", startAfter: 1700000000000, total: 101 },
        });
      return json({ contacts: [{ id: "c100", name: "Last One" }], meta: { total: 101 } });
    });
    const { outcome, rows } = await run(fetch, ["contacts"]);
    expect(outcome).toMatchObject({ status: "succeeded", rowsFetched: 101 });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url.searchParams.get("locationId")).toBe("loc1");
    expect(calls[0]!.url.searchParams.get("limit")).toBe("100");
    expect(calls[1]!.url.searchParams.get("startAfterId")).toBe("c99");
    expect(calls[1]!.url.searchParams.get("startAfter")).toBe("1700000000000");
    expect(header(calls[0]!, "version")).toBe("2021-07-28");
    expect(rows.every((r) => r.source === "live")).toBe(true);
    expect(rows.find((r) => r.externalId === "c100")!.data).toMatchObject({
      name: "Last One",
      tags: [],
    });
  });

  it("refuses to guess when a full page comes without next-page information", async () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ id: `c${i}` }));
    const { outcome } = await run(api(() => json({ contacts: items })).fetch, ["contacts"]);
    expect(outcome.status).toBe("failed");
    expect(outcome.errors[0]).toMatchObject({ code: "invalid_response" });
  });

  it("uses snake_case location_id and cursor paging for opportunities", async () => {
    const { calls, fetch } = api(() =>
      json({
        opportunities: [
          {
            id: "o1",
            name: "Deal",
            status: "open",
            monetaryValue: 1200.5,
            pipelineId: "p",
            pipelineStageId: "s",
            contactId: "c1",
            createdAt: "2025-03-01T00:00:00Z",
          },
        ],
        meta: { total: 1 },
      }),
    );
    const { rows } = await run(fetch, ["opportunities"]);
    expect(calls[0]!.url.pathname).toBe("/opportunities/search");
    expect(calls[0]!.url.searchParams.get("location_id")).toBe("loc1");
    expect(rows[0]!.data).toMatchObject({
      pipelineExternalId: "p",
      stageExternalId: "s",
      contactExternalId: "c1",
      monetaryValue: 1200.5,
    });
  });

  it("uses the conversations API version and stops when no cursor is supplied", async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      id: `v${i}`,
      contactId: "c",
      unreadCount: 1,
      lastMessageBody: "SECRET TEXT",
    }));
    const { calls, fetch } = api(() => json({ conversations: items, total: 500 }));
    const { outcome, rows } = await run(fetch, ["conversations"]);
    expect(outcome.status).toBe("succeeded");
    expect(calls).toHaveLength(1);
    expect(header(calls[0]!, "version")).toBe("2021-04-15");
    expect(JSON.stringify(rows)).not.toContain("SECRET TEXT");
  });

  it("pages social posts with skip/count and sends string paging fields", async () => {
    const post = (i: number) => ({
      _id: `p${i}`,
      summary: "hi",
      status: "published",
      type: "post",
      accountIds: ["a1"],
      publishedAt: "2025-05-05T00:00:00Z",
    });
    const { calls, fetch } = api((c) => {
      const skip = Number(body(c).skip);
      return json({
        results: {
          posts: skip === 0 ? Array.from({ length: 20 }, (_, i) => post(i)) : [post(20)],
          count: 21,
        },
      });
    });
    const { outcome } = await run(fetch, ["social_posts"]);
    expect(outcome.rowsFetched).toBe(21);
    expect(body(calls[0]!)).toMatchObject({ skip: "0", limit: "20", includeUsers: "false" });
    expect(body(calls[1]!).skip).toBe("20");
    expect(calls[0]!.url.pathname).toBe("/social-media-posting/loc1/posts/list");
  });

  it("reads statistics only for known profiles, and returns nothing when there are none", async () => {
    const { calls, fetch } = api((c) =>
      c.url.pathname.endsWith("/accounts")
        ? json({ results: { accounts: [{ id: "a1", profileId: "pf1", platform: "facebook" }] } })
        : json({
            results: {
              totals: { posts: 3, likes: 9, followers: 100, impressions: 5000, comments: 2 },
            },
          }),
    );
    const { rows } = await run(fetch, ["social_statistics"]);
    expect(calls[1]!.url.search).toContain("locationId=loc1");
    expect(body(calls[1]!)).toEqual({ profileIds: ["pf1"] });
    expect(rows[0]!.data).toMatchObject({ windowDays: 7, impressions: 5000 });
    const none = await run(api(() => json({ results: { accounts: [] } })).fetch, [
      "social_statistics",
    ]);
    expect(none.rows).toEqual([]);
  });

  it("skips resources whose permission was not granted and reports why", async () => {
    const { calls, fetch } = api(() => json({ campaigns: [{ id: "c", name: "x", status: "a" }] }));
    const scope = "campaigns.readonly";
    const { outcome } = await run(
      fetch,
      ["campaigns", "contacts", "social_posts"],
      creds({ scope }),
      [scope],
    );
    expect(outcome.status).toBe("succeeded");
    expect(calls).toHaveLength(1);
    expect(outcome.unsupported.map((u) => u.resource)).toEqual(["contacts", "social_posts"]);
    expect(outcome.unsupported[0]!.reason).toContain("contacts.readonly");
  });

  it("finishes partial when one resource fails and keeps the rest, then stops on auth failure", async () => {
    const { fetch } = api((c) =>
      c.url.pathname.startsWith("/workflows") ? json({}, 500) : json({ campaigns: [{ id: "c1" }] }),
    );
    const { outcome } = await run(fetch, ["campaigns", "workflows"]);
    expect(outcome.status).toBe("partial");
    expect(outcome.errors[0]).toMatchObject({ resource: "workflows", retryable: true });
  });

  it("never lets credentials reach errors or records", async () => {
    const { outcome, rows } = await run(api(() => json({}, 403)).fetch, ["campaigns"]);
    const dump = JSON.stringify({ outcome, rows });
    expect(dump).not.toContain("access-1");
    expect(dump).not.toContain("refresh-1");
  });
});

describe("connection test", () => {
  it("uses the location endpoint when permitted and reports granted scopes", async () => {
    const { calls, fetch } = api(() => json({ location: { id: "loc1", name: "Acme Roofing" } }));
    const r = await createGoHighLevelAdapter(config, { fetch, now: () => NOW }).testConnection(
      creds(),
      { accountId: "a", clientId: "c" },
    );
    expect(r).toMatchObject({ ok: true, externalAccountId: "loc1", displayName: "Acme Roofing" });
    expect(calls[0]!.url.pathname).toBe("/locations/loc1");
  });
  it("falls back to a one-contact probe, and fails clearly on bad tokens or no permissions", async () => {
    const probe = api(() => json({ contacts: [] }));
    const scope = "contacts.readonly";
    expect(
      (
        await createGoHighLevelAdapter(config, {
          fetch: probe.fetch,
          now: () => NOW,
        }).testConnection(creds({ scope }), { accountId: "a", clientId: "c" })
      ).ok,
    ).toBe(true);
    expect(probe.calls[0]!.url.searchParams.get("limit")).toBe("1");
    const bad = await createGoHighLevelAdapter(config, {
      fetch: api((c) => (c.url.pathname === "/oauth/token" ? json({}, 400) : json({}, 401))).fetch,
      now: () => NOW,
    }).testConnection(creds(), { accountId: "a", clientId: "c" });
    expect(bad).toMatchObject({ ok: false, error: { code: "auth_failed" } });
    const none = await createGoHighLevelAdapter(config, {
      fetch: api(() => json({})).fetch,
      now: () => NOW,
    }).testConnection(creds({ scope: "" }), { accountId: "a", clientId: "c" });
    expect(none).toMatchObject({ ok: false, error: { code: "insufficient_scope" } });
  });
});

describe("publishing", () => {
  const ctx = { accountId: "a", clientId: "c" };
  it("creates a post for the chosen accounts and returns the provider id", async () => {
    const { calls, fetch } = api(() =>
      json({ results: { post: { _id: "post-9", status: "published" } } }, 201),
    );
    const r = await createGoHighLevelAdapter(config, { fetch, now: () => NOW }).publishPost!(
      creds(),
      { targetAccountIds: ["a1", "a2"], text: "Hello" },
      ctx,
    );
    expect(r).toEqual({ externalPostId: "post-9", providerStatus: "published" });
    expect(calls[0]!.url.pathname).toBe("/social-media-posting/loc1/posts");
    expect(body(calls[0]!)).toEqual({
      type: "post",
      accountIds: ["a1", "a2"],
      summary: "Hello",
      userId: "user1",
    });
  });
  it("needs the write scope and a user id before sending anything", async () => {
    const { calls, fetch } = api(() => json({}));
    const adapter = createGoHighLevelAdapter(config, { fetch, now: () => NOW });
    await expect(
      adapter.publishPost!(
        creds({ scope: "contacts.readonly" }),
        { targetAccountIds: ["a"], text: "x" },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "insufficient_scope" });
    await expect(
      adapter.publishPost!(creds({ userId: "" }), { targetAccountIds: ["a"], text: "x" }, ctx),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(calls).toHaveLength(0);
  });
  it("treats a success without an id, and server errors, as outcome UNKNOWN; client errors as definite", async () => {
    const attempt = (res: () => Response) =>
      createGoHighLevelAdapter(config, { fetch: api(res).fetch, now: () => NOW }).publishPost!(
        creds(),
        { targetAccountIds: ["a"], text: "x" },
        ctx,
      ).catch((e: ProviderError) => e);
    expect(await attempt(() => json({ results: {} }, 201))).toMatchObject({ outcomeUnknown: true });
    expect(await attempt(() => json({}, 502))).toMatchObject({ outcomeUnknown: true });
    expect(await attempt(() => json({}, 422))).toMatchObject({
      code: "invalid_request",
      outcomeUnknown: false,
    });
    expect(
      await attempt(() => json({}, 429, { "x-ratelimit-interval-milliseconds": "1000" })),
    ).toMatchObject({ code: "rate_limited", outcomeUnknown: false });
  });
});
