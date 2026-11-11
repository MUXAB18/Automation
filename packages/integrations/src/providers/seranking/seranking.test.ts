import { describe, expect, it, vi } from "vitest";
import { RateLimiter } from "../../framework/rate-limiter";
import { runSync } from "../../framework/runner";
import type { NormalizedRecord, SyncSink } from "../../framework/types";
import { createSeRankingAdapter } from "./adapter";
import { SERANKING_MIN_INTERVAL_MS, type SeRankingSettings } from "./config";

const KEY = "sr-key-0123456789";
const TODAY = new Date("2026-03-31T12:00:00Z");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

type Call = { url: URL; headers: Record<string, string> };
function api(handler: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: URL | string, init: RequestInit = {}) => {
    const call = { url: new URL(String(input)), headers: init.headers as Record<string, string> };
    calls.push(call);
    return handler(call);
  });
  return { calls, fetch: fetchMock as unknown as typeof fetch };
}

function clock() {
  const c = {
    t: 1_000_000,
    sleeps: [] as number[],
    now: () => c.t,
    sleep: async (ms: number) => {
      c.sleeps.push(ms);
      c.t += ms;
    },
  };
  return c;
}

const settings = (...p: Partial<SeRankingSettings["projects"][number]>[]): SeRankingSettings => ({
  projects: p.map((x, i) => ({
    siteId: String(100 + i),
    siteEngineId: 7,
    rankingsThrough: null,
    ...x,
  })),
});

function setup(handler: (c: Call) => Response | Promise<Response>) {
  const { calls, fetch } = api(handler);
  const c = clock();
  const adapter = createSeRankingAdapter(
    {},
    { fetch, sleep: c.sleep, now: c.now, today: () => TODAY },
  );
  return { adapter, calls, clock: c };
}

const creds = { apiKey: KEY };
const ctxWith = (s?: SeRankingSettings) => ({ accountId: "acct", clientId: "c", settings: s });
const page = (
  adapter: ReturnType<typeof setup>["adapter"],
  resource: string,
  s?: SeRankingSettings,
  cursor: string | null = null,
) => adapter.fetchPage(creds, { resource, cursor, since: null }, ctxWith(s));

describe("connection and errors", () => {
  it("tests the key against the project list and sends it as 'Token <key>'", async () => {
    const { adapter, calls } = setup(() =>
      json([
        { id: 1, name: "a.com" },
        { id: 2, name: "b.com" },
      ]),
    );
    const r = await adapter.testConnection(creds, ctxWith());
    expect(r).toMatchObject({ ok: true, displayName: "SE Ranking (2 projects)" });
    expect(calls[0]!.url.href).toBe("https://api.seranking.com/v1/project-management/sites");
    expect(calls[0]!.headers.authorization).toBe(`Token ${KEY}`);
  });

  it("separates a bad key (403 'Incorrect token') from a plan limit (403 'No access')", async () => {
    const bad = await setup(() => json({ message: "Incorrect token" }, 403)).adapter.testConnection(
      creds,
      ctxWith(),
    );
    expect(bad).toMatchObject({ ok: false, error: { code: "auth_failed", needsReconnect: true } });
    const plan = setup(() => json({ message: "No access" }, 403));
    await expect(page(plan.adapter, "backlinks", settings({}))).rejects.toMatchObject({
      code: "plan_restricted",
      needsReconnect: false,
    });
  });

  it("maps 429 to a long back-off hint and 5xx to a retryable error, never leaking the key", async () => {
    await expect(
      page(setup(() => json({}, 429)).adapter, "competitors", settings({})),
    ).rejects.toMatchObject({ code: "rate_limited", retryAfterMs: 15_000 });
    const err = await page(
      setup(() => json({ message: KEY }, 500)).adapter,
      "competitors",
      settings({}),
    ).catch((e: Error) => e);
    expect(err).toMatchObject({ code: "provider_unavailable", retryable: true });
    expect(JSON.stringify(err)).not.toContain(KEY);
  });

  it("spaces calls at least 250 ms apart (the API allows 5 per second)", async () => {
    const { adapter, clock: c } = setup((call) =>
      call.url.pathname.endsWith("/sites") ? json([{ id: 1 }, { id: 2 }, { id: 3 }]) : json([]),
    );
    const times: number[] = [];
    const orig = c.now;
    c.now = () => orig();
    await page(adapter, "projects");
    expect(c.sleeps.length).toBe(3); // 4 calls (1 list + 3 engines) -> 3 waits
    expect(c.sleeps.every((ms) => ms > 0 && ms <= SERANKING_MIN_INTERVAL_MS)).toBe(true);
    void times;
  });
});

describe("resources", () => {
  it("discovers projects with their engines, and drops engines without an id", async () => {
    const { adapter, calls } = setup((c) =>
      c.url.pathname.endsWith("/sites")
        ? json([{ id: 11, title: "Acme", name: "acme.ca", is_active: 1, keyword_count: 40 }])
        : json([
            { site_engine_id: 7, search_engine_id: 1, region_name: "Canada", lang_code: "en" },
            { region_name: "no id" },
          ]),
    );
    const p = await page(adapter, "projects");
    const rows = adapter.normalize("projects", p.items, ctxWith());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      externalId: "11",
      source: "live",
      data: { name: "acme.ca", providerActive: true, keywordCount: 40 },
    });
    expect((rows[0]!.data.engines as unknown[]).length).toBe(1);
    expect(calls[1]!.url.searchParams.get("site_id")).toBe("11");
  });

  it("returns nothing when no project is linked", async () => {
    const { adapter, calls } = setup(() => json([]));
    for (const r of [
      "keywords",
      "rankings",
      "competitors",
      "backlinks",
      "project_summary",
      "audits",
    ]) {
      expect(await page(adapter, r, settings())).toEqual({ items: [], nextCursor: null });
    }
    expect(calls).toHaveLength(0);
  });

  it("walks linked projects one per page with the chosen engine, and isolates a deleted project", async () => {
    const { adapter, calls } = setup((c) =>
      c.url.searchParams.get("site_id") === "100"
        ? json({ message: "Not Found" }, 404)
        : json([{ id: "k1", name: "freight forwarding", link: "https://acme.ca/f", tags: [3] }]),
    );
    const s = settings({}, {});
    const first = await page(adapter, "keywords", s);
    expect(adapter.normalize("keywords", first.items, ctxWith(s))).toEqual([
      expect.objectContaining({ resource: "project_missing", externalId: "100" }),
    ]);
    expect(first.nextCursor).not.toBeNull();
    const second = await page(adapter, "keywords", s, first.nextCursor);
    expect(second.nextCursor).toBeNull();
    const rows = adapter.normalize("keywords", second.items, ctxWith(s));
    expect(rows[0]).toMatchObject({
      externalId: "101:k1",
      data: {
        term: "freight forwarding",
        targetUrl: "https://acme.ca/f",
        tags: ["3"],
        siteId: "101",
      },
    });
    expect(calls[1]!.url.searchParams.get("site_engine_id")).toBe("7");
  });

  it("reads the first sync as 90 days in 30-day windows, then continues from the stored day with a 7-day overlap", async () => {
    const seen: string[] = [];
    const { adapter } = setup((c) => {
      seen.push(`${c.url.searchParams.get("date_from")}..${c.url.searchParams.get("date_to")}`);
      return json([
        {
          site_engine_id: 7,
          keywords: [
            {
              id: "k1",
              volume: 900,
              positions: [
                { date: "2026-03-30", pos: 4, change: 1 },
                { date: "2026-03-31", pos: 0 },
              ],
              landing_pages: [
                { url: "https://acme.ca/a", date: "2026-03-01" },
                { url: "https://acme.ca/b", date: "2026-03-31" },
              ],
            },
          ],
        },
      ]);
    });
    const s = settings({});
    let cursor: string | null = null;
    let rows: NormalizedRecord[] = [];
    do {
      const p = await page(adapter, "rankings", s, cursor);
      rows = rows.concat(adapter.normalize("rankings", p.items, ctxWith(s)));
      cursor = p.nextCursor;
    } while (cursor);
    expect(seen).toEqual([
      "2025-12-31..2026-01-29",
      "2026-01-30..2026-02-28",
      "2026-03-01..2026-03-30",
      "2026-03-31..2026-03-31",
    ]);
    const last = rows.at(-1)!;
    expect(last).toMatchObject({
      externalId: "100:k1:2026-03-31",
      data: { position: null, url: "https://acme.ca/b", volume: 900 },
    });
    expect(rows.find((r) => r.externalId.endsWith("2026-03-30"))!.data).toMatchObject({
      position: 4,
      url: "https://acme.ca/a",
    });

    seen.length = 0;
    await page(adapter, "rankings", settings({ rankingsThrough: "2026-03-28" }));
    expect(seen).toEqual(["2026-03-21..2026-03-31"]);
  });

  it("reads summary, competitors and backlink totals as reported", async () => {
    const { adapter } = setup((c) =>
      c.url.pathname.endsWith("/summary")
        ? json({ top10: 12, visibility_percent: "34.5", da: 21 })
        : c.url.pathname.endsWith("/competitors")
          ? json([{ id: 5, name: "Rival", url: "https://rival.com", domain_trust: 40 }])
          : json({
              total: 500,
              domains: 80,
              anchors: 30,
              ip: 70,
              dofollow: 300,
              nofollow: 200,
              limit: 450,
            }),
    );
    const s = settings({});
    expect(
      adapter.normalize(
        "project_summary",
        (await page(adapter, "project_summary", s)).items,
        ctxWith(s),
      )[0]!.data,
    ).toMatchObject({ summary: { top10: 12, visibility_percent: 34.5, da: 21, top5: null } });
    expect(
      adapter.normalize(
        "competitors",
        (await page(adapter, "competitors", s)).items,
        ctxWith(s),
      )[0],
    ).toMatchObject({ externalId: "100:5", data: { name: "Rival", domainTrust: 40 } });
    expect(
      adapter.normalize("backlinks", (await page(adapter, "backlinks", s)).items, ctxWith(s))[0]!
        .data,
    ).toMatchObject({ total: 500, domains: 80, remainingDailyAdds: 450 });
  });
});

describe("site audits", () => {
  const auditItem = (id: number, site: number | null, status: string, date: string) => ({
    id,
    url: "acme.ca",
    title: "Acme",
    site_id: site,
    last_update: date,
    status,
    stats: { score: 80, errors: 2, warnings: 3, notices: 4, crawled: 120 },
  });
  const report = {
    is_finished: true,
    score_percent: 81,
    total_pages: 120,
    sections: [
      {
        uid: "s1",
        name: "Meta tags",
        props: [
          { code: "title_missing", status: "error", name: "Missing title", value: 4 },
          { code: "h1_ok", status: "passed", name: "H1", value: 0 },
          { code: "desc_long", status: "warning", name: "Long description", value: 9 },
        ],
      },
    ],
  };

  it("pages the account audit list, keeps only linked sites, and reads the latest finished audit's report with example URLs", async () => {
    const { adapter, calls } = setup((c) => {
      if (c.url.pathname.endsWith("/audits/report")) return json(report);
      if (c.url.pathname.endsWith("/issue-pages"))
        return json({
          total_urls: 4,
          urls: [`https://acme.ca/${c.url.searchParams.get("code")}-1`],
        });
      return c.url.searchParams.get("offset") === "0"
        ? json({
            total: 3,
            items: [
              auditItem(1, 100, "finished", "2026-01-01"),
              auditItem(2, 999, "finished", "2026-03-01"),
            ],
          })
        : json({ total: 3, items: [auditItem(3, 100, "finished", "2026-03-15")] });
    });
    const s = settings({});
    const records: NormalizedRecord[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const p = await page(adapter, "audits", s, cursor);
      records.push(...adapter.normalize("audits", p.items, ctxWith(s)));
      cursor = p.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3); // two list pages + one report
    expect(records.filter((r) => r.resource === "audits").map((r) => r.externalId)).toEqual([
      "100:1",
      "100:3",
    ]);
    expect(
      calls.some(
        (c) =>
          c.url.pathname.endsWith("/audits/report") && c.url.searchParams.get("audit_id") === "3",
      ),
    ).toBe(true);
    const issues = records.filter((r) => r.resource === "audit_issues");
    expect(issues.map((r) => r.externalId).sort()).toEqual([
      "100:desc_long",
      "100:h1_ok",
      "100:title_missing",
    ]);
    expect(issues.find((r) => r.externalId === "100:title_missing")!.data).toMatchObject({
      status: "error",
      pagesAffected: 4,
      sampleUrls: ["https://acme.ca/title_missing-1"],
      section: "Meta tags",
    });
    expect(issues.find((r) => r.externalId === "100:h1_ok")!.data.sampleUrls).toEqual([]);
    expect(records.find((r) => r.resource === "audit_reports")).toMatchObject({
      externalId: "100:3",
      data: { checks: 3, score: 81 },
    });
  });

  it("emits no issues for an unfinished report, and keeps the issue when example URLs fail", async () => {
    const unfinished = setup((c) =>
      c.url.pathname.endsWith("/report")
        ? json({ ...report, is_finished: false })
        : json({ total: 1, items: [auditItem(9, 100, "finished", "2026-03-01")] }),
    );
    const s = settings({});
    const list = await page(unfinished.adapter, "audits", s);
    const r = await page(unfinished.adapter, "audits", s, list.nextCursor);
    expect(unfinished.adapter.normalize("audits", r.items, ctxWith(s))).toEqual([]);

    const flaky = setup((c) =>
      c.url.pathname.endsWith("/issue-pages")
        ? json({}, 500)
        : c.url.pathname.endsWith("/report")
          ? json(report)
          : json({ total: 1, items: [auditItem(9, 100, "finished", "2026-03-01")] }),
    );
    const l2 = await page(flaky.adapter, "audits", s);
    const r2 = await page(flaky.adapter, "audits", s, l2.nextCursor);
    const rows = flaky.adapter.normalize("audits", r2.items, ctxWith(s));
    expect(rows.filter((x) => x.resource === "audit_issues")).toHaveLength(3);
  });

  it("does nothing when no linked project has a finished audit", async () => {
    const { adapter } = setup(() =>
      json({ total: 1, items: [auditItem(1, 100, "processing", "2026-03-01")] }),
    );
    const s = settings({});
    const p = await page(adapter, "audits", s);
    expect(p.nextCursor).toBeNull();
  });
});

describe("full sync through the shared pipeline", () => {
  function run(handler: (c: Call) => Response | Promise<Response>, s: SeRankingSettings) {
    const { adapter, clock: c } = setup(handler);
    const rows: NormalizedRecord[] = [];
    const sink: SyncSink = { write: async (r) => (rows.push(...r), r.length) };
    return runSync({
      adapter,
      credentials: creds,
      ctx: ctxWith(s),
      sink,
      limiter: new RateLimiter({ perSecond: 1000 }),
      clock: c,
    }).then((outcome) => ({ outcome, rows }));
  }
  const happy = (c: Call) => {
    const p = c.url.pathname;
    if (p.endsWith("/sites")) return json([{ id: 100, name: "acme.ca" }]);
    if (p.endsWith("/search-engines"))
      return json([{ site_engine_id: 7, region_name: "Canada", lang_code: "en" }]);
    if (p.endsWith("/keywords")) return json([{ id: "k1", name: "kw" }]);
    if (p.endsWith("/sites/positions"))
      return json([
        {
          site_engine_id: 7,
          keywords: [{ id: "k1", positions: [{ date: "2026-03-31", pos: 3 }] }],
        },
      ]);
    if (p.endsWith("/summary")) return json({ top10: 1 });
    if (p.endsWith("/competitors")) return json([{ id: 1, url: "https://r.com" }]);
    if (p.endsWith("/backlinks/stats")) return json({ total: 10 });
    if (p.endsWith("/audits")) return json({ total: 0, items: [] });
    return json({}, 404);
  };

  it("syncs every resource and tags nothing as mock", async () => {
    const { outcome, rows } = await run(happy, settings({ rankingsThrough: "2026-03-30" }));
    expect(outcome).toMatchObject({ status: "succeeded", source: "live" });
    expect(new Set(rows.map((r) => r.resource))).toEqual(
      new Set(["projects", "keywords", "rankings", "project_summary", "competitors", "backlinks"]),
    );
    expect(rows.every((r) => r.source === "live")).toBe(true);
  });

  it("reports a plan-restricted feature as unsupported, not as an error, and still syncs the rest", async () => {
    const { outcome, rows } = await run(
      (c) =>
        c.url.pathname.includes("/backlinks") ? json({ message: "Access denied" }, 403) : happy(c),
      settings({ rankingsThrough: "2026-03-30" }),
    );
    expect(outcome.status).toBe("succeeded");
    expect(outcome.errors).toEqual([]);
    expect(outcome.unsupported).toEqual([expect.objectContaining({ resource: "backlinks" })]);
    expect(rows.some((r) => r.resource === "competitors")).toBe(true);
  });

  it("stops and asks for reconnection when the key is rejected", async () => {
    const { outcome } = await run(() => json({ message: "Incorrect token" }, 403), settings({}));
    expect(outcome).toMatchObject({ status: "failed", needsReconnect: true });
    expect(outcome.errors).toHaveLength(1);
  });

  it("finishes partial when one resource breaks", async () => {
    const { outcome } = await run(
      (c) => (c.url.pathname.endsWith("/competitors") ? json({}, 500) : happy(c)),
      settings({ rankingsThrough: "2026-03-30" }),
    );
    expect(outcome.status).toBe("partial");
    expect(outcome.errors[0]).toMatchObject({ resource: "competitors", retryable: true });
  });
});
