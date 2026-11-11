import { beforeEach, describe, expect, it } from "vitest";
import { createTokenCipherForTests } from "../../test/cipher";
import { addMember, makeAgency, makeClient, makeUser, prisma, resetDb } from "../../test/helpers";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { getGa4Panel, getGscPanel, validateRange } from "./analytics-dashboard";
import {
  _resetMetricCatalogueCache,
  dimensionKeyOf,
  listAnalyticsSources,
  loadGoogleSettings,
  persistGoogleRecords,
  setAnalyticsSourceSelection,
} from "./analytics-data";
import { connectAccount } from "./integrations";

beforeEach(async () => {
  await resetDb();
  _resetMetricCatalogueCache();
});
const cipher = createTokenCipherForTests();
type Rec = { resource: string; externalId: string; data: Record<string, unknown> };

async function world() {
  const agency = await makeAgency("Agency");
  const other = await makeAgency("Other");
  const a = await makeClient("A", "a", agency.id);
  const b = await makeClient("B", "b", other.id);
  await prisma().integration.createMany({
    data: [
      { key: "google_analytics_4", name: "GA4", category: "analytics", authType: "oauth2" },
      { key: "google_search_console", name: "GSC", category: "search", authType: "oauth2" },
    ],
  });
  const manager = await makeUser();
  await addMember(manager, a.id, "seo_manager");
  const specialist = await makeUser();
  await addMember(specialist, a.id, "seo_specialist");
  const client = await makeUser();
  await addMember(client, a.id, "client");
  const outsider = await makeUser();
  await addMember(outsider, b.id, "seo_manager");
  const base = { agencyId: a.agencyId, clientId: a.id };
  const connect = (key: string) =>
    connectAccount(
      manager,
      {
        clientId: a.id,
        integrationKey: key,
        externalAccountId: "google",
        credentials: { kind: "oauth", refreshToken: "refresh-secret-123" },
        scopes: [],
      },
      cipher,
    );
  const ga = await connect("google_analytics_4");
  const gsc = await connect("google_search_console");
  const runs = new Map<string, string>();
  const persist = async (account: { id: string }, records: Rec[], name = "r1") => {
    const key = `${account.id}:${name}`;
    if (!runs.has(key))
      runs.set(
        key,
        (
          await prisma().syncRun.create({
            data: {
              ...base,
              integrationAccountId: account.id,
              status: "succeeded",
              finishedAt: new Date(),
            },
          })
        ).id,
      );
    return persistGoogleRecords(
      { ...base, accountId: account.id, syncRunId: runs.get(key)! },
      records,
    );
  };
  const website = await prisma().website.create({ data: { ...base, domain: "acme.ca" } });
  return { a, b, base, manager, specialist, client, outsider, ga, gsc, persist, website };
}

const prop = (id: string, kind: "ga4" | "search_console", extra = {}) => ({
  resource: "properties",
  externalId: id,
  data: { kind, displayName: `Prop ${id}`, propertyType: "x", permissionLevel: null, ...extra },
});
const m = (
  sourceKey: string,
  kind: "ga4" | "search_console",
  set: string,
  day: string,
  values: Record<string, number | null>,
  dimensions: Record<string, string> = {},
  isFinal = true,
): Rec => ({
  resource: "metrics",
  externalId: `${sourceKey}:${set}:${day}:${dimensionKeyOf(dimensions)}`,
  data: { sourceKey, kind, set, day, dimensions, values, isFinal },
});
const ga4Totals = (
  day: string,
  sessions: number,
  engaged: number,
  extra: Record<string, number | null> = {},
  isFinal = true,
) =>
  m(
    "123",
    "ga4",
    "totals",
    day,
    {
      "ga4.sessions": sessions,
      "ga4.engaged_sessions": engaged,
      "ga4.avg_session_duration": 100,
      "ga4.total_users": sessions * 0.8,
      "ga4.key_events": 2,
      "ga4.new_users": 10,
      "ga4.page_views": sessions * 2,
      ...extra,
    },
    {},
    isFinal,
  );

async function selectGa4(w: Awaited<ReturnType<typeof world>>) {
  await w.persist(w.ga, [prop("123", "ga4")]);
  const src = await prisma().analyticsSource.findFirstOrThrow({ where: { externalId: "123" } });
  await setAnalyticsSourceSelection(w.manager, { sourceId: src.id, active: true });
  return src;
}

describe("property discovery and selection", () => {
  it("discovers properties as not selected; nothing is stored for them until a person selects them", async () => {
    const w = await world();
    await w.persist(w.ga, [prop("123", "ga4")]);
    const src = await prisma().analyticsSource.findFirstOrThrow();
    expect(src).toMatchObject({ kind: "ga4", isActive: false, displayName: "Prop 123" });
    expect(await w.persist(w.ga, [ga4Totals("2026-04-01", 10, 5)])).toBe(0);
    expect(await prisma().metricSnapshot.count()).toBe(0);
    expect(await loadGoogleSettings(w.ga.id)).toEqual({ sources: [] });
    await setAnalyticsSourceSelection(w.manager, { sourceId: src.id, active: true });
    expect(await loadGoogleSettings(w.ga.id)).toEqual({
      sources: [{ externalId: "123", dataThrough: null }],
    });
  });

  it("re-discovery updates facts but keeps the person's choice", async () => {
    const w = await world();
    const src = await selectGa4(w);
    await w.persist(w.ga, [prop("123", "ga4", { displayName: "Renamed" })], "r2");
    expect(
      await prisma().analyticsSource.findUniqueOrThrow({ where: { id: src.id } }),
    ).toMatchObject({ isActive: true, displayName: "Renamed" });
    expect(await prisma().analyticsSource.count()).toBe(1);
  });

  it("needs integration.manage, hides other tenants, validates the website, and refuses unverified Search Console sites", async () => {
    const w = await world();
    await w.persist(w.gsc, [
      prop("sc-domain:acme.ca", "search_console", { permissionLevel: "siteUnverifiedUser" }),
      prop("sc-domain:ok.ca", "search_console", { permissionLevel: "siteOwner" }),
    ]);
    const [unverified, ok] = [
      await prisma().analyticsSource.findFirstOrThrow({
        where: { externalId: "sc-domain:acme.ca" },
      }),
      await prisma().analyticsSource.findFirstOrThrow({ where: { externalId: "sc-domain:ok.ca" } }),
    ];
    await expect(
      setAnalyticsSourceSelection(w.specialist, { sourceId: ok.id, active: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      setAnalyticsSourceSelection(w.outsider, { sourceId: ok.id, active: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      setAnalyticsSourceSelection(w.manager, { sourceId: unverified.id, active: true }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      setAnalyticsSourceSelection(w.manager, {
        sourceId: ok.id,
        active: true,
        websiteId: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await setAnalyticsSourceSelection(w.manager, {
      sourceId: ok.id,
      active: true,
      websiteId: w.website.id,
    });
    expect(
      await prisma().analyticsSource.findUniqueOrThrow({ where: { id: ok.id } }),
    ).toMatchObject({ isActive: true, websiteId: w.website.id });
    expect(await prisma().auditLog.count({ where: { action: "analytics.source_selected" } })).toBe(
      1,
    );
    const list = await listAnalyticsSources(w.specialist, w.gsc.id);
    expect(list.canManage).toBe(false);
    expect(list.sources).toHaveLength(2);
    expect(JSON.stringify(list)).not.toContain("refresh-secret");
  });
});

describe("storing metric snapshots", () => {
  it("stores each reading once and appends only new, changed, or newly final values", async () => {
    const w = await world();
    await selectGa4(w);
    const first = await w.persist(w.ga, [
      ga4Totals("2026-04-01", 100, 60),
      ga4Totals("2026-04-02", 90, 50, {}, false),
    ]);
    expect(first).toBe(14);
    expect(await w.persist(w.ga, [ga4Totals("2026-04-01", 100, 60)], "r2")).toBe(0); // identical re-import
    // provisional day turns final with the same numbers, then a revised one
    expect(await w.persist(w.ga, [ga4Totals("2026-04-02", 90, 50, {}, true)], "r3")).toBe(7);
    expect(await w.persist(w.ga, [ga4Totals("2026-04-01", 105, 60)], "r4")).toBe(2 + 1); // sessions and page_views changed... plus users
    const sessions = await prisma().metricSnapshot.findMany({
      where: { metricDefinition: { key: "ga4.sessions" }, periodStart: new Date("2026-04-01") },
      orderBy: { capturedAt: "asc" },
    });
    expect(sessions.map((s) => s.value.toNumber())).toEqual([100, 105]);
  });

  it("never stores unknown metrics or values Google did not report, and keeps dimensions apart", async () => {
    const w = await world();
    await selectGa4(w);
    await w.persist(w.ga, [
      m("123", "ga4", "totals", "2026-04-01", {
        "ga4.sessions": 5,
        "ga4.bounce_rate": null,
        "made.up": 9,
      }),
      m(
        "123",
        "ga4",
        "channel",
        "2026-04-01",
        { "ga4.sessions": 3 },
        { channel: "Organic Search" },
      ),
      m("123", "ga4", "channel", "2026-04-01", { "ga4.sessions": 2 }, { channel: "Direct" }),
    ]);
    const rows = await prisma().metricSnapshot.findMany({
      include: { metricDefinition: true },
      orderBy: { dimensionKey: "asc" },
    });
    expect(rows.map((r) => [r.metricDefinition.key, r.dimensionKey])).toEqual([
      ["ga4.sessions", ""],
      ["ga4.sessions", "channel=Direct"],
      ["ga4.sessions", "channel=Organic Search"],
    ]);
  });

  it("advances 'data through' only from final daily totals, and records then clears access problems", async () => {
    const w = await world();
    const src = await selectGa4(w);
    await w.persist(w.ga, [
      ga4Totals("2026-04-01", 1, 1),
      ga4Totals("2026-04-03", 1, 1, {}, false),
      m("123", "ga4", "channel", "2026-04-05", { "ga4.sessions": 1 }, { channel: "Direct" }),
    ]);
    const read = () => prisma().analyticsSource.findUniqueOrThrow({ where: { id: src.id } });
    expect((await read()).dataThrough?.toISOString().slice(0, 10)).toBe("2026-04-01");
    await w.persist(
      w.ga,
      [
        {
          resource: "source_problem",
          externalId: "123",
          data: { sourceKey: "123", kind: "ga4", code: "access_denied", message: "No access" },
        },
      ],
      "r2",
    );
    expect(((await read()).metadata as { problem?: { code: string } }).problem?.code).toBe(
      "access_denied",
    );
    await w.persist(w.ga, [ga4Totals("2026-04-02", 1, 1)], "r3");
    const after = await read();
    expect((after.metadata as { problem?: unknown }).problem).toBeUndefined();
    expect(after.dataThrough?.toISOString().slice(0, 10)).toBe("2026-04-02");
    expect(after.lastSyncedAt).not.toBeNull();
  });
});

describe("dashboards", () => {
  const range = { from: "2026-04-01", to: "2026-04-10" };

  it("shows nothing for a client without a selected source, and refuses other tenants", async () => {
    const w = await world();
    expect(await getGa4Panel(w.manager, w.a.id, range)).toMatchObject({
      source: null,
      kpis: null,
      series: [],
    });
    await expect(getGa4Panel(w.outsider, w.a.id, range)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getGscPanel(w.outsider, w.a.id, range)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("GA4: sums additive metrics, derives rates from sums, weights duration by sessions, and the latest reading wins", async () => {
    const w = await world();
    await selectGa4(w);
    await w.persist(w.ga, [
      ga4Totals("2026-04-01", 100, 60, { "ga4.avg_session_duration": 60 }),
      ga4Totals("2026-04-02", 300, 150, { "ga4.avg_session_duration": 120 }),
      ga4Totals("2026-03-20", 999, 999),
    ]);
    await w.persist(
      w.ga,
      [ga4Totals("2026-04-01", 120, 60, { "ga4.avg_session_duration": 60 })],
      "r2",
    ); // revised
    const p = await getGa4Panel(w.manager, w.a.id, range);
    expect(p.kpis).toMatchObject({
      sessions: 420,
      engagedSessions: 210,
      keyEvents: 4,
      newUsers: 20,
      pageViews: 840,
    });
    expect(p.kpis!.engagementRate).toBeCloseTo(0.5, 6);
    expect(p.kpis!.avgSessionSeconds).toBeCloseTo((120 * 60 + 300 * 120) / 420, 6);
    expect(p.series.map((s) => [s.day, s.sessions])).toEqual([
      ["2026-04-01", 120],
      ["2026-04-02", 300],
    ]);
    expect(p.freshness).toMatchObject({ hasData: true, dataThrough: "2026-04-02", problem: null });
    expect(p.freshness!.lagDays).toBeGreaterThan(0);
    expect(p.freshness!.lastRun?.status).toBe("succeeded");
  });

  it("GA4: channels and landing pages are summed per dimension over the range", async () => {
    const w = await world();
    await selectGa4(w);
    const ch = (day: string, channel: string, s: number) =>
      m(
        "123",
        "ga4",
        "channel",
        day,
        { "ga4.sessions": s, "ga4.engaged_sessions": s / 2, "ga4.key_events": 1 },
        { channel },
      );
    await w.persist(w.ga, [
      ch("2026-04-01", "Organic Search", 10),
      ch("2026-04-02", "Organic Search", 20),
      ch("2026-04-01", "Direct", 5),
      m("123", "ga4", "landing_page", "2026-04-01", { "ga4.sessions": 7 }, { page: "/pricing" }),
    ]);
    const p = await getGa4Panel(w.manager, w.a.id, range);
    expect(p.channels).toEqual([
      { name: "Organic Search", sessions: 30, engagedSessions: 15, keyEvents: 2 },
      { name: "Direct", sessions: 5, engagedSessions: 2.5, keyEvents: 1 },
    ]);
    expect(p.landingPages[0]).toMatchObject({ name: "/pricing", sessions: 7 });
  });

  it("Search Console: CTR is clicks over impressions and position is weighted by impressions, never averaged", async () => {
    const w = await world();
    await w.persist(w.gsc, [
      prop("sc-domain:acme.ca", "search_console", { permissionLevel: "siteOwner" }),
    ]);
    const src = await prisma().analyticsSource.findFirstOrThrow();
    await setAnalyticsSourceSelection(w.manager, { sourceId: src.id, active: true });
    const g = (
      day: string,
      clicks: number,
      impressions: number,
      position: number,
      dims: Record<string, string> = {},
      set = "totals",
    ) =>
      m(
        "sc-domain:acme.ca",
        "search_console",
        set,
        day,
        {
          "gsc.clicks": clicks,
          "gsc.impressions": impressions,
          "gsc.ctr": clicks / impressions,
          "gsc.position": position,
        },
        dims,
      );
    await w.persist(w.gsc, [
      g("2026-04-01", 10, 100, 10),
      g("2026-04-02", 30, 900, 5),
      g("2026-04-01", 8, 60, 4, { query: "freight quote" }, "query"),
      g("2026-04-02", 5, 40, 8, { query: "freight quote" }, "query"),
      g("2026-04-01", 2, 90, 20, { query: "other" }, "query"),
      g("2026-04-01", 6, 50, 3, { page: "https://acme.ca/a" }, "page"),
      g("2026-04-01", 9, 70, 6, { device: "mobile" }, "device"),
    ]);
    const p = await getGscPanel(w.manager, w.a.id, range);
    expect(p.kpis!.clicks).toBe(40);
    expect(p.kpis!.impressions).toBe(1000);
    expect(p.kpis!.ctr).toBeCloseTo(0.04, 6);
    expect(p.kpis!.position).toBeCloseTo((10 * 100 + 5 * 900) / 1000, 6); // 5.5, not the plain average 7.5
    expect(p.queries[0]).toMatchObject({ name: "freight quote", clicks: 13, impressions: 100 });
    expect(p.queries[0]!.position).toBeCloseTo((4 * 60 + 8 * 40) / 100, 6);
    expect(p.queries[0]!.ctr).toBeCloseTo(0.13, 6);
    expect(p.pages).toEqual([expect.objectContaining({ name: "https://acme.ca/a", clicks: 6 })]);
    expect(p.devices).toEqual([expect.objectContaining({ name: "mobile", clicks: 9 })]);
    // the client role may read analytics but cannot change anything
    await expect(getGscPanel(w.client, w.a.id, range)).resolves.toBeTruthy();
  });

  it("GA4 and Search Console panels never mix: each only reads its own source", async () => {
    const w = await world();
    await selectGa4(w);
    await w.persist(w.ga, [ga4Totals("2026-04-01", 100, 60)]);
    const gscPanel = await getGscPanel(w.manager, w.a.id, range);
    expect(gscPanel).toMatchObject({ source: null, kpis: null });
  });

  it("validates date ranges", () => {
    expect(validateRange({ from: "2026-04-01", to: "2026-04-01" })).toBeTruthy();
    expect(() => validateRange({ from: "2026-04-10", to: "2026-04-01" })).toThrow(ValidationError);
    expect(() => validateRange({ from: "nope", to: "2026-04-01" })).toThrow(ValidationError);
    expect(() => validateRange({ from: "2024-01-01", to: "2026-04-01" })).toThrow(ValidationError);
  });
});
