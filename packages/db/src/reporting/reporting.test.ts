import { beforeEach, describe, expect, it } from "vitest";
import { createTokenCipherForTests } from "../../test/cipher";
import {
  addAgencyStaff,
  addMember,
  makeAgency,
  makeClient,
  makeUser,
  prisma,
  resetDb,
} from "../../test/helpers";
import { createMockAiProvider } from "../ai/mock-provider";
import type { AiRuntimeConfig } from "../ai/provider";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { connectAccount } from "../services/integrations";
import {
  _resetMetricCatalogueCache,
  dimensionKeyOf,
  persistGoogleRecords,
  setAnalyticsSourceSelection,
} from "../services/analytics-data";
import {
  claimNextDelivery,
  finishDelivery,
  loadDeliveryJob,
  markDeliveryRequestSent,
  reapStaleDeliveries,
} from "./delivery";
import { validMetric, hashData } from "./document";
import { collectMetrics, previousRange } from "./metrics";
import { lastFullPeriod, latestDuePeriod, nextPeriodAfter, periodAt, runAtFor } from "./periods";
import {
  generateReport,
  getReport,
  listReportsFor,
  requestReport,
  resendDelivery,
  retryReport,
  reviewReport,
  sendReport,
  deterministicSummary,
  recommendationsFrom,
  factsOf,
} from "./report";
import { runDueSchedules, saveSchedule } from "./schedule";

beforeEach(async () => {
  await resetDb();
  _resetMetricCatalogueCache();
});
const cipher = createTokenCipherForTests();
const aiCfg: AiRuntimeConfig = {
  provider: "test",
  model: "test-1",
  defaultMonthlyRequests: 50,
  defaultMonthlyCostUsd: 0,
  perUserHourly: 50,
};
type Rec = { resource: string; externalId: string; data: Record<string, unknown> };
const NOW = new Date("2026-11-16T15:00:00Z"); // Monday 10:00 in Toronto

async function world(opts: { sources?: boolean } = {}) {
  const agency = await makeAgency("Agency");
  const other = await makeAgency("Other");
  const a = await makeClient("Client A", "a", agency.id);
  const b = await makeClient("Client B", "b", other.id);
  await prisma().client.update({ where: { id: a.id }, data: { timezone: "America/Toronto" } });
  await prisma().integration.createMany({
    data: [
      { key: "google_analytics_4", name: "GA4", category: "analytics", authType: "oauth2" },
      { key: "google_search_console", name: "GSC", category: "search", authType: "oauth2" },
    ],
  });
  const manager = await makeUser();
  await addMember(manager, a.id, "seo_manager");
  const reviewer = await makeUser();
  await addMember(reviewer, a.id, "reviewer");
  const client = await makeUser();
  await addMember(client, a.id, "client");
  const specialist = await makeUser();
  await addMember(specialist, a.id, "seo_specialist");
  const outsider = await makeUser();
  await addMember(outsider, b.id, "seo_manager");
  const clientB = await makeUser();
  await addMember(clientB, b.id, "client");
  const base = { agencyId: a.agencyId, clientId: a.id };
  const w = {
    agency,
    a,
    b,
    base,
    manager,
    reviewer,
    client,
    specialist,
    outsider,
    clientB,
    ga: null as { id: string } | null,
    gsc: null as { id: string } | null,
  };
  if (opts.sources) {
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
    w.ga = await connect("google_analytics_4");
    w.gsc = await connect("google_search_console");
    const run = (acct: { id: string }) =>
      prisma().syncRun.create({
        data: {
          ...base,
          integrationAccountId: acct.id,
          status: "succeeded",
          finishedAt: new Date(),
        },
      });
    const [r1, r2] = await Promise.all([run(w.ga), run(w.gsc)]);
    const rec = (kind: "ga4" | "search_console", id: string) => ({
      resource: "properties",
      externalId: id,
      data: { kind, displayName: id, propertyType: "x", permissionLevel: null },
    });
    await persistGoogleRecords({ ...base, accountId: w.ga.id, syncRunId: r1.id }, [
      rec("ga4", "123"),
    ]);
    await persistGoogleRecords({ ...base, accountId: w.gsc.id, syncRunId: r2.id }, [
      rec("search_console", "sc-domain:a.ca"),
    ]);
    for (const src of await prisma().analyticsSource.findMany())
      await setAnalyticsSourceSelection(manager, { sourceId: src.id, active: true });
    await prisma().analyticsSource.updateMany({
      data: { dataThrough: new Date("2026-11-15T00:00:00Z") },
    });
  }
  return w;
}
type W = Awaited<ReturnType<typeof world>>;

const metricRec = (
  sourceKey: string,
  kind: "ga4" | "search_console",
  set: string,
  day: string,
  values: Record<string, number | null>,
  dims: Record<string, string> = {},
): Rec => ({
  resource: "metrics",
  externalId: `${sourceKey}:${set}:${day}:${dimensionKeyOf(dims)}`,
  data: { sourceKey, kind, set, day, dimensions: dims, values, isFinal: true },
});
async function persistMetrics(w: W, account: { id: string }, records: Rec[]) {
  const run = await prisma().syncRun.create({
    data: {
      ...w.base,
      integrationAccountId: account.id,
      status: "succeeded",
      finishedAt: new Date(),
    },
  });
  return persistGoogleRecords({ ...w.base, accountId: account.id, syncRunId: run.id }, records);
}
const days = (from: string, n: number) =>
  Array.from({ length: n }, (_, i) =>
    new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10),
  );

/** Current window 2026-11-01..11-15 (15 days) and previous 2026-10-17..10-31. */
async function seedSearch(w: W) {
  const recs: Rec[] = [];
  for (const d of days("2026-11-01", 15))
    recs.push(
      metricRec("sc-domain:a.ca", "search_console", "totals", d, {
        "gsc.clicks": 100,
        "gsc.impressions": 2000,
        "gsc.ctr": 0.05,
        "gsc.position": 10,
      }),
    );
  for (const d of days("2026-10-17", 15))
    recs.push(
      metricRec("sc-domain:a.ca", "search_console", "totals", d, {
        "gsc.clicks": 50,
        "gsc.impressions": 1000,
        "gsc.ctr": 0.05,
        "gsc.position": 20,
      }),
    );
  await persistMetrics(w, w.gsc!, recs);
}
async function seedTraffic(w: W, current = days("2026-11-01", 15)) {
  const recs: Rec[] = [];
  for (const d of current) {
    recs.push(
      metricRec("123", "ga4", "totals", d, {
        "ga4.sessions": 200,
        "ga4.engaged_sessions": 120,
        "ga4.key_events": 4,
        "ga4.avg_session_duration": 90,
        "ga4.total_users": 150,
        "ga4.new_users": 50,
        "ga4.page_views": 400,
      }),
    );
    recs.push(
      metricRec("123", "ga4", "channels", d, { "ga4.sessions": 80 }, { channel: "Organic Search" }),
    );
  }
  for (const d of days("2026-10-17", 15))
    recs.push(
      metricRec("123", "ga4", "totals", d, {
        "ga4.sessions": 100,
        "ga4.engaged_sessions": 50,
        "ga4.key_events": 2,
        "ga4.avg_session_duration": 90,
        "ga4.total_users": 80,
        "ga4.new_users": 20,
        "ga4.page_views": 200,
      }),
    );
  await persistMetrics(w, w.ga!, recs);
}
const R = { from: "2026-11-01", to: "2026-11-15" };
const scope = (w: W, over = {}) => ({ clientIds: [w.a.id], now: NOW, ...over });

describe("reporting periods", () => {
  it("uses consecutive 15-day windows from the anchor and runs the morning after, in the client's zone", () => {
    expect(periodAt("2026-11-01", 15, 0)).toEqual({
      index: 0,
      start: "2026-11-01",
      end: "2026-11-15",
    });
    expect(periodAt("2026-11-01", 15, 1)).toEqual({
      index: 1,
      start: "2026-11-16",
      end: "2026-11-30",
    });
    expect(runAtFor(periodAt("2026-11-01", 15, 0), 9, "America/Toronto").toISOString()).toBe(
      "2026-11-16T14:00:00.000Z",
    ); // 09:00 EST
    expect(runAtFor(periodAt("2026-03-01", 15, 0), 9, "America/Toronto").toISOString()).toBe(
      "2026-03-16T13:00:00.000Z",
    ); // 09:00 EDT
  });
  it("a period is due only after its local run time", () => {
    expect(
      latestDuePeriod("2026-11-01", 15, 9, "America/Toronto", new Date("2026-11-16T13:59:00Z")),
    ).toBeNull();
    expect(
      latestDuePeriod("2026-11-01", 15, 9, "America/Toronto", new Date("2026-11-16T14:00:00Z"))
        ?.end,
    ).toBe("2026-11-15");
    expect(
      latestDuePeriod("2026-11-01", 15, 9, "America/Toronto", new Date("2026-12-20T00:00:00Z"))
        ?.end,
    ).toBe("2026-12-15"); // missed runs collapse into the latest
    expect(
      latestDuePeriod("2026-11-20", 15, 9, "UTC", new Date("2026-11-16T00:00:00Z")),
    ).toBeNull(); // before the anchor
  });
  it("the same instant is a different local day in different zones", () => {
    const now = new Date("2026-11-16T03:00:00Z"); // still Nov 15 evening in Vancouver, already Nov 16 in UTC
    expect(latestDuePeriod("2026-11-01", 15, 0, "UTC", now)?.end).toBe("2026-11-15");
    expect(latestDuePeriod("2026-11-01", 15, 0, "America/Vancouver", now)).toBeNull();
  });
  it("finds the next run and the last full period", () => {
    expect(nextPeriodAfter("2026-11-01", 15, 9, "America/Toronto", NOW).period.start).toBe(
      "2026-11-16",
    );
    expect(lastFullPeriod(15, "America/Toronto", NOW)).toEqual({
      start: "2026-11-01",
      end: "2026-11-15",
    });
    expect(previousRange(R)).toEqual({ from: "2026-10-17", to: "2026-10-31" });
  });
  it("moves a run time that daylight saving skips", () => {
    // 02:30 does not exist on 2027-03-14 in Toronto; the run lands an hour on rather than failing.
    expect(
      runAtFor(
        { index: 0, start: "2027-02-28", end: "2027-03-13" },
        2,
        "America/Toronto",
      ).toISOString(),
    ).toBe("2027-03-14T07:00:00.000Z");
  });
});

describe("metric calculations", () => {
  it("sums search metrics, derives CTR and weights position by impressions, and compares with the previous period", async () => {
    const w = await world({ sources: true });
    await seedSearch(w);
    const m = await collectMetrics(scope(w), R);
    expect(m.search.clicks).toMatchObject({
      value: 1500,
      previous: 750,
      changePct: 100,
      state: "ok",
    });
    expect(m.search.impressions.value).toBe(30000);
    expect(m.search.ctr.value).toBeCloseTo(5, 5); // 1500 / 30000, derived from the sums
    expect(m.search.position).toMatchObject({ value: 10, previous: 20 });
    expect(m.search.series).toHaveLength(15);
  });

  it("weights position by impressions rather than averaging days", async () => {
    const w = await world({ sources: true });
    await persistMetrics(w, w.gsc!, [
      metricRec("sc-domain:a.ca", "search_console", "totals", "2026-11-01", {
        "gsc.clicks": 10,
        "gsc.impressions": 9000,
        "gsc.ctr": 0,
        "gsc.position": 5,
      }),
      metricRec("sc-domain:a.ca", "search_console", "totals", "2026-11-02", {
        "gsc.clicks": 1,
        "gsc.impressions": 1000,
        "gsc.ctr": 0,
        "gsc.position": 50,
      }),
    ]);
    expect((await collectMetrics(scope(w), R)).search.position.value).toBeCloseTo(9.5, 5);
  });

  it("computes traffic, organic sessions, engagement rate and key events", async () => {
    const w = await world({ sources: true });
    await seedTraffic(w);
    const m = await collectMetrics(scope(w), R);
    expect(m.traffic.sessions).toMatchObject({ value: 3000, previous: 1500, state: "ok" });
    expect(m.traffic.organicSessions.value).toBe(1200);
    expect(m.traffic.engagementRate.value).toBeCloseTo(60, 5);
    expect(m.traffic.keyEvents.value).toBe(60);
  });

  it("never invents a metric: no account is 'no_source' and no data is 'no_data', both null, never zero", async () => {
    const w = await world({ sources: true });
    const empty = await collectMetrics(scope(w), R);
    expect(empty.search.clicks).toMatchObject({ value: null, state: "no_data" });
    expect(empty.traffic.sessions.value).toBeNull();
    expect(empty.rankings.state).toBe("no_source");
  });

  it("without any connected account every analytics metric is 'no_source'", async () => {
    const none = await collectMetrics(scope(await world()), R);
    for (const x of [
      none.search.clicks,
      none.search.ctr,
      none.search.position,
      none.traffic.sessions,
      none.traffic.engagementRate,
    ])
      expect(x).toMatchObject({ value: null, state: "no_source" });
  });

  it("flags partial coverage instead of presenting it as a full period", async () => {
    const w = await world({ sources: true });
    await seedTraffic(w, days("2026-11-01", 5));
    const m = await collectMetrics(scope(w), R);
    expect(m.traffic.sessions).toMatchObject({ value: 1000, state: "partial" });
    expect(m.traffic.sessions.note).toMatch(/5 of 15 days/);
  });

  it("uses the latest reading when a day was re-synced", async () => {
    const w = await world({ sources: true });
    await persistMetrics(w, w.gsc!, [
      metricRec("sc-domain:a.ca", "search_console", "totals", "2026-11-01", {
        "gsc.clicks": 10,
        "gsc.impressions": 100,
        "gsc.ctr": 0.1,
        "gsc.position": 3,
      }),
    ]);
    await persistMetrics(w, w.gsc!, [
      metricRec("sc-domain:a.ca", "search_console", "totals", "2026-11-01", {
        "gsc.clicks": 25,
        "gsc.impressions": 100,
        "gsc.ctr": 0.25,
        "gsc.position": 3,
      }),
    ]);
    expect((await collectMetrics(scope(w), R)).search.clicks.value).toBe(25);
  });

  it("excludes development mock sources unless asked, and says so", async () => {
    const w = await world({ sources: true });
    await seedSearch(w);
    await prisma().analyticsSource.updateMany({ data: { metadata: { mock: true } } });
    expect((await collectMetrics(scope(w), R)).search.clicks.state).toBe("no_source");
    const shown = await collectMetrics(scope(w, { includeMock: true }), R);
    expect(shown.search.clicks.value).toBe(1500);
    expect(shown.includesMock).toBe(true);
  });

  it("reports freshness per source and marks old data stale", async () => {
    const w = await world({ sources: true });
    await prisma().analyticsSource.updateMany({
      where: { kind: "ga4" },
      data: { dataThrough: new Date("2026-11-01T00:00:00Z") },
    });
    const f = (await collectMetrics(scope(w), R)).freshness;
    expect(f.find((x) => x.label.includes("Analytics"))).toMatchObject({
      dataThrough: "2026-11-01",
      stale: true,
    });
    expect(f.find((x) => x.label.includes("Search Console"))?.stale).toBe(false);
  });

  it("counts work from the database: completed, overdue (internal only), resolved issues, per project", async () => {
    const w = await world();
    const p1 = await prisma().project.create({
      data: { ...w.base, name: "P1", slug: "p1", kind: "general" } as never,
    });
    const p2 = await prisma().project.create({
      data: { ...w.base, name: "P2", slug: "p2", kind: "general" } as never,
    });
    const done = (projectId: string, at: string) =>
      prisma().task.create({
        data: { ...w.base, projectId, title: "t", status: "completed", completedAt: new Date(at) },
      });
    await done(p1.id, "2026-11-03T12:00:00Z");
    await done(p1.id, "2026-11-04T12:00:00Z");
    await done(p2.id, "2026-11-05T12:00:00Z");
    await done(p1.id, "2026-10-20T12:00:00Z");
    await prisma().task.create({
      data: {
        ...w.base,
        projectId: p1.id,
        title: "late",
        status: "in_progress",
        dueAt: new Date("2026-11-10T00:00:00Z"),
      },
    });
    const all = await collectMetrics(scope(w, { internal: true }), R);
    expect(all.work.completed).toMatchObject({ value: 3, previous: 1 });
    expect(all.work.overdue.value).toBe(1);
    expect((await collectMetrics(scope(w, { projectId: p1.id }), R)).work.completed.value).toBe(2);
    // Reports and the portal never see the internal figures.
    expect((await collectMetrics(scope(w), R)).work.overdue.value).toBeNull();
    expect((await collectMetrics(scope(w), R)).ai).toBeNull();
  });

  it("compares keyword rankings against the earlier reading and ignores sample keywords", async () => {
    const w = await world();
    const project = await prisma().project.create({
      data: { ...w.base, name: "SEO", slug: "seo", kind: "seo" } as never,
    });
    const website = await prisma().website.create({ data: { ...w.base, domain: "a.ca" } });
    const sp = await prisma().seoProject.create({
      data: { ...w.base, projectId: project.id, websiteId: website.id },
    });
    const kw = (term: string, isSample = false) =>
      prisma().keyword.create({ data: { ...w.base, seoProjectId: sp.id, term, isSample } });
    const [up, down, flat, sample] = await Promise.all([
      kw("up"),
      kw("down"),
      kw("flat"),
      kw("sample", true),
    ]);
    const snap = (k: { id: string }, day: string, position: number) =>
      prisma().keywordRankSnapshot.create({
        data: {
          ...w.base,
          keywordId: k.id,
          source: "se_ranking",
          checkedOn: new Date(`${day}T00:00:00Z`),
          position,
        },
      });
    for (const [k, a, b] of [
      [up, 20, 8],
      [down, 5, 12],
      [flat, 7, 7],
      [sample, 50, 1],
    ] as const) {
      await snap(k, "2026-10-31", a);
      await snap(k, "2026-11-14", b);
    }
    const r = (await collectMetrics(scope(w), R)).rankings;
    expect(r).toMatchObject({ tracked: 3, withChange: 3, improved: 1, declined: 1, unchanged: 1 });
    expect(r.topImproved[0]).toMatchObject({ term: "up", from: 20, to: 8 });
    expect(r.topDeclined[0]).toMatchObject({ term: "down" });
  });

  it("counts social posts (direct and by hand) and shows engagement only where a provider reported it", async () => {
    const w = await world({ sources: true });
    const item = await prisma().contentItem.create({
      data: {
        ...w.base,
        title: "Post",
        type: "social_post",
        channel: "facebook",
        status: "published",
      },
    });
    const manual = await prisma().contentItem.create({
      data: {
        ...w.base,
        title: "Hand",
        type: "social_post",
        channel: "linkedin",
        status: "published",
      },
    });
    const ver = (id: string) =>
      prisma().contentVersion.create({
        data: { ...w.base, contentItemId: id, versionNo: 1, body: "x" },
      });
    await ver(item.id);
    await ver(manual.id);
    await prisma().manualPublication.create({
      data: {
        ...w.base,
        contentItemId: manual.id,
        contentVersionId: (
          await prisma().contentVersion.findFirstOrThrow({ where: { contentItemId: manual.id } })
        ).id,
        publishedAt: new Date("2026-11-05T12:00:00Z"),
        markedById: w.manager.userId,
      },
    });
    const m = await collectMetrics(scope(w), R);
    expect(m.social.published.value).toBe(1);
    expect(m.social.engagement).toMatchObject({ state: "no_data", impressions: null });
  });
});

describe("validation", () => {
  it("drops values outside what the metric can be", () => {
    const base = {
      key: "gsc.ctr",
      label: "CTR",
      unit: "percent" as const,
      value: 140,
      previous: null,
      changePct: null,
      state: "ok" as const,
    };
    expect(validMetric(base)).toMatchObject({ value: null, state: "no_data" });
    expect(validMetric({ ...base, key: "ga4.sessions", unit: "count", value: -3 })).toMatchObject({
      value: null,
    });
    expect(
      validMetric({ ...base, key: "gsc.position", unit: "position", value: 0.2 }),
    ).toMatchObject({ value: null });
    expect(validMetric({ ...base, value: 4.2 }).value).toBe(4.2);
    expect(validMetric({ ...base, value: Number.NaN }).value).toBeNull();
  });
  it("hashes data the same way whatever the key order", () => {
    expect(hashData({ a: 1, b: { c: 2, d: 3 } })).toBe(hashData({ b: { d: 3, c: 2 }, a: 1 }));
    expect(hashData({ a: 1 })).not.toBe(hashData({ a: 2 }));
  });
});

async function readyReport(w: W, deps = null as Parameters<typeof generateReport>[1]) {
  const { id } = await requestReport(w.manager, { clientId: w.a.id }, NOW);
  await generateReport(id, deps, NOW);
  return id;
}

describe("report generation", () => {
  it("defaults to the last full 15-day period in the client's time zone and does not duplicate it", async () => {
    const w = await world();
    const a = await requestReport(w.manager, { clientId: w.a.id }, NOW);
    const b = await requestReport(w.manager, { clientId: w.a.id }, NOW);
    expect(b).toEqual({ id: a.id, created: false });
    const r = await prisma().report.findUniqueOrThrow({ where: { id: a.id } });
    expect([
      r.periodStart.toISOString().slice(0, 10),
      r.periodEnd.toISOString().slice(0, 10),
      r.status,
      r.revision,
    ]).toEqual(["2026-11-01", "2026-11-15", "generating", 1]);
    await expect(
      requestReport(
        w.manager,
        { clientId: w.a.id, periodStart: "2026-11-10", periodEnd: "2026-12-30" },
        NOW,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      requestReport(w.manager, { clientId: w.a.id, periodEnd: "2026-11-20" }, NOW),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("builds every section from real data, freezes the figures with a hash and records freshness", async () => {
    const w = await world({ sources: true });
    await seedSearch(w);
    await seedTraffic(w);
    const id = await readyReport(w);
    const d = await getReport(w.manager, id);
    expect(d.view.sections.map((s) => s.key)).toEqual([
      "summary",
      "seo",
      "search_traffic",
      "social",
      "work",
      "issues",
      "recommendations",
      "data_sources",
    ]);
    expect(String(d.view.sections[0]!.content.text)).toMatch(/1,500 organic clicks/);
    expect(d.report.snapshots.map((s) => s.key).sort()).toEqual([
      "rankings",
      "search",
      "social",
      "sources",
      "traffic",
      "work",
    ]);
    expect(d.report.snapshots.every((s) => s.dataHash.length === 64)).toBe(true);
    const sources = d.view.sections.find((s) => s.key === "data_sources")!.content.sources as {
      dataThrough: string;
    }[];
    expect(sources.map((x) => x.dataThrough)).toEqual(["2026-11-15", "2026-11-15"]);
    expect((await prisma().report.findUniqueOrThrow({ where: { id } })).status).toBe("ready");
    expect(
      await prisma().notification.count({
        where: { userId: w.reviewer.userId, type: "report.ready" },
      }),
    ).toBe(1);
  });

  it("says plainly what is missing instead of filling it in", async () => {
    const w = await world();
    const id = await readyReport(w);
    const d = await getReport(w.manager, id);
    const text = String(d.view.sections[0]!.content.text);
    expect(text).toMatch(/Search Console data is not available/);
    expect(text).toMatch(/Google Analytics data is not available/);
    expect(
      JSON.stringify(d.view.sections.find((s) => s.key === "search_traffic")!.content),
    ).not.toMatch(/"value":0\b/);
    const recs = d.view.sections.find((s) => s.key === "recommendations")!.content.items as {
      title: string;
    }[];
    expect(recs.map((r) => r.title)).toEqual(
      expect.arrayContaining(["Connect Google Search Console", "Connect Google Analytics"]),
    );
  });

  it("template choices decide which sections appear", async () => {
    const w = await world();
    const admin = await makeUser();
    await addAgencyStaff(admin, w.agency.id, "agency_admin", true);
    const { saveReportTemplate } = await import("./report");
    await saveReportTemplate(admin, w.agency.id, {
      sections: [
        { key: "summary", enabled: true },
        { key: "work", enabled: true },
        { key: "social", enabled: false },
      ],
      defaultIntervalDays: 15,
      useAi: false,
      titlePattern: "{{client}} report {{period}}",
    });
    const id = await readyReport(w);
    expect((await getReport(w.manager, id)).view.sections.map((s) => s.key)).toEqual([
      "summary",
      "work",
    ]);
    await expect(
      saveReportTemplate(admin, w.agency.id, {
        sections: [{ key: "summary", enabled: false }],
        defaultIntervalDays: 15,
        useAi: false,
        titlePattern: "abc",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("an AI summary is used only when every cited figure was supplied; otherwise the fixed wording stays", async () => {
    const w = await world({ sources: true });
    await seedSearch(w);
    const { saveReportTemplate } = await import("./report");
    const admin = await makeUser();
    await addAgencyStaff(admin, w.agency.id, "agency_admin", true);
    await saveReportTemplate(admin, w.agency.id, {
      sections: ["summary", "search_traffic"].map((key) => ({ key, enabled: true })),
      defaultIntervalDays: 15,
      useAi: true,
      titlePattern: "{{client}} {{period}}",
    });
    const good = JSON.stringify({
      summary: "Organic clicks were 1500.",
      highlights: ["Clicks doubled."],
      risks: [],
      nextSteps: [],
      figuresUsed: [{ label: "Organic clicks", value: 1500 }],
    });
    const id1 = await readyReport(w, {
      provider: {
        key: "fake",
        generate: async (req) => ({ text: good, inputTokens: 10, outputTokens: 5, ...(req && {}) }),
      },
      config: aiCfg,
    });
    const s1 = (await getReport(w.manager, id1)).view.sections[0]!;
    expect(s1.aiGenerated).toBe(true);
    expect(String(s1.content.text)).toContain("Organic clicks were 1500");
    expect(
      await prisma().aiJob.count({ where: { task: "report_summary", status: "succeeded" } }),
    ).toBe(1);

    const lying = JSON.stringify({
      summary: "Clicks grew 900%.",
      highlights: [],
      risks: [],
      nextSteps: [],
      figuresUsed: [{ label: "Organic clicks", value: 99999 }],
    });
    await prisma().report.deleteMany({});
    const id2 = await readyReport(w, {
      provider: {
        key: "fake",
        generate: async () => ({ text: lying, inputTokens: 1, outputTokens: 1 }),
      },
      config: aiCfg,
    });
    const s2 = (await getReport(w.manager, id2)).view.sections[0]!;
    expect(s2.aiGenerated).toBe(false);
    expect(String(s2.content.text)).not.toMatch(/900%/);
    expect(await prisma().aiJob.count({ where: { status: "queued" } })).toBe(0); // no orphaned retry
  });

  it("the mock provider never writes a client-facing summary", async () => {
    const w = await world({ sources: true });
    await seedSearch(w);
    const id = await readyReport(w, {
      provider: createMockAiProvider(),
      config: { ...aiCfg, provider: "mock" },
    });
    expect((await getReport(w.manager, id)).view.sections[0]!.aiGenerated).toBe(false);
  });

  it("marks a report failed with a safe message and lets a person retry it", async () => {
    const w = await world();
    const { id } = await requestReport(w.manager, { clientId: w.a.id }, NOW);
    await prisma().reportTemplate.updateMany({ data: { layout: { sections: [] } } }); // unusable template: falls back to the default layout
    await generateReport(id, null, NOW);
    expect((await prisma().report.findUniqueOrThrow({ where: { id } })).status).toBe("ready");
    await prisma().report.update({ where: { id }, data: { status: "failed", error: "x" } });
    await retryReport(w.manager, id);
    expect((await prisma().report.findUniqueOrThrow({ where: { id } })).status).toBe("generating");
    await expect(retryReport(w.manager, id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("derives recommendations only from the figures", async () => {
    const w = await world({ sources: true });
    await prisma().seoIssue.count();
    const m = await collectMetrics(scope(w), R);
    const recs = recommendationsFrom(m);
    expect(recs.every((r) => r.reason.length > 0)).toBe(true);
    expect(deterministicSummary(m, "Client A", R.from, R.to)).toMatch(/not available/);
    expect(factsOf(m)).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "Tasks completed", value: 0 })]),
    );
  });
});

describe("review and visibility", () => {
  it("authors cannot approve their own manual report; reviewers can; changes need a reason", async () => {
    const w = await world();
    const id = await readyReport(w);
    await expect(reviewReport(w.manager, id, { decision: "approve" })).rejects.toThrow(
      /someone else/,
    );
    await expect(
      reviewReport(w.reviewer, id, { decision: "request_changes" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(reviewReport(w.specialist, id, { decision: "approve" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await reviewReport(w.reviewer, id, { decision: "approve" });
    expect((await prisma().report.findUniqueOrThrow({ where: { id } })).status).toBe("approved");
    await expect(reviewReport(w.reviewer, id, { decision: "approve" })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("a client sees only approved reports of their own client; drafts look like they do not exist", async () => {
    const w = await world();
    const id = await readyReport(w);
    await expect(getReport(w.client, id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listReportsFor(w.client, {})).rows).toHaveLength(0);
    await reviewReport(w.reviewer, id, { decision: "approve" });
    const d = await getReport(w.client, id);
    expect(d.staff).toBe(false);
    expect(d.deliveries).toEqual([]);
    expect((await listReportsFor(w.client, {})).rows).toHaveLength(1);
  });

  it("another client's people and another agency cannot read, review, send or resend it", async () => {
    const w = await world();
    const id = await readyReport(w);
    await reviewReport(w.reviewer, id, { decision: "approve" });
    for (const stranger of [w.clientB, w.outsider]) {
      await expect(getReport(stranger, id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(reviewReport(stranger, id, { decision: "approve" })).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(sendReport(stranger, id, ["x@y.com"])).rejects.toBeInstanceOf(NotFoundError);
      expect((await listReportsFor(stranger, {})).rows).toHaveLength(0);
    }
    await expect(requestReport(w.outsider, { clientId: w.a.id }, NOW)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("people who only view cannot generate", async () => {
    const w = await world();
    await expect(requestReport(w.client, { clientId: w.a.id }, NOW)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

async function approved(w: W) {
  const id = await readyReport(w);
  await reviewReport(w.reviewer, id, { decision: "approve" });
  return id;
}

describe("delivery", () => {
  it("never queues the same recipient twice, whatever the letter case, and skips existing ones on a second send", async () => {
    const w = await world();
    const id = await approved(w);
    expect(
      await sendReport(w.manager, id, ["Ann@Example.com", "ann@example.com", "bob@example.com"]),
    ).toEqual({ added: 2, skipped: 0 });
    expect(await sendReport(w.manager, id, ["ANN@example.com", "cy@example.com"])).toEqual({
      added: 1,
      skipped: 1,
    });
    expect(await prisma().reportDelivery.count({ where: { reportId: id } })).toBe(3);
    await expect(sendReport(w.manager, id, ["not-an-email"])).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("only an approved report can be sent", async () => {
    const w = await world();
    const id = await readyReport(w);
    await expect(sendReport(w.manager, id, ["a@b.com"])).rejects.toBeInstanceOf(ConflictError);
  });

  it("sends once, records the attempt and marks the report delivered", async () => {
    const w = await world();
    const id = await approved(w);
    await sendReport(w.manager, id, ["ann@example.com"]);
    const d = (await claimNextDelivery())!;
    expect(await claimNextDelivery()).toBeNull(); // nobody else can take it
    const job = (await loadDeliveryJob(d))!;
    expect(job.idempotencyKey).toBe(`report-delivery:${d}:0`);
    await markDeliveryRequestSent(d);
    await finishDelivery(d, { kind: "sent", messageId: "m-1" });
    await finishDelivery(d, { kind: "sent", messageId: "m-2" }); // a repeated answer changes nothing
    const row = await prisma().reportDelivery.findUniqueOrThrow({
      where: { id: d },
      include: { reportDeliveryAttempts: true },
    });
    expect(row).toMatchObject({ status: "sent", providerMessageId: "m-1", attempts: 1 });
    expect(row.reportDeliveryAttempts).toHaveLength(1);
    expect((await prisma().report.findUniqueOrThrow({ where: { id } })).status).toBe("delivered");
    expect(await claimNextDelivery()).toBeNull();
  });

  it("retries transient failures with backoff, then gives up and tells the people responsible", async () => {
    const w = await world();
    const id = await approved(w);
    await sendReport(w.manager, id, ["ann@example.com"]);
    let last = "";
    for (let n = 1; n <= 4; n++) {
      await prisma()
        .$executeRaw`UPDATE report_deliveries SET next_attempt_at = now() - interval '1 second' WHERE status = 'pending'`;
      last = (await claimNextDelivery())!;
      expect(last).toBeTruthy();
      await finishDelivery(last, { kind: "retry", message: "busy" });
      if (n < 4) {
        const row = await prisma().reportDelivery.findUniqueOrThrow({ where: { id: last } });
        expect(row.status).toBe("pending");
        expect(row.nextAttemptAt).not.toBeNull();
        expect(await claimNextDelivery()).toBeNull(); // not before its time
      }
    }
    const row = await prisma().reportDelivery.findUniqueOrThrow({ where: { id: last } });
    expect(row).toMatchObject({ status: "failed", attempts: 4 });
    expect(row.error).toMatch(/Gave up after 4 attempts/);
    expect(
      await prisma().notification.count({
        where: { type: "report.delivery_failed", userId: w.reviewer.userId },
      }),
    ).toBe(1);
  });

  it("a permanent refusal fails at once; an unknown outcome waits for a person and is never retried by itself", async () => {
    const w = await world();
    const id = await approved(w);
    await sendReport(w.manager, id, ["bad@example.com", "maybe@example.com"]);
    const a = (await claimNextDelivery())!;
    const b = (await claimNextDelivery())!;
    await finishDelivery(a, { kind: "failed", message: "Address rejected" });
    await markDeliveryRequestSent(b);
    await finishDelivery(b, { kind: "unknown", message: "timeout" });
    expect((await prisma().reportDelivery.findUniqueOrThrow({ where: { id: a } })).status).toBe(
      "failed",
    );
    expect((await prisma().reportDelivery.findUniqueOrThrow({ where: { id: b } })).status).toBe(
      "needs_review",
    );
    expect(await claimNextDelivery()).toBeNull();
    await expect(resendDelivery(w.manager, b)).rejects.toThrow(/could not confirm/);
    await resendDelivery(w.manager, b, { confirmNotReceived: true });
    await resendDelivery(w.manager, a);
    const again = await prisma().reportDelivery.findUniqueOrThrow({ where: { id: a } });
    expect(again).toMatchObject({ status: "pending", resendCount: 1 });
    expect((await loadDeliveryJob((await claimNextDelivery())!))!.idempotencyKey).toMatch(/:1$/); // a resend is a new send
  });

  it("a manual resend of a sent report goes through the same row and is refused while one is already queued", async () => {
    const w = await world();
    const id = await approved(w);
    await sendReport(w.manager, id, ["ann@example.com"]);
    const d = (await claimNextDelivery())!;
    await expect(resendDelivery(w.manager, d)).rejects.toThrow(/already queued/);
    await finishDelivery(d, { kind: "sent", messageId: "m" });
    await resendDelivery(w.manager, d);
    expect(await prisma().reportDelivery.count()).toBe(1);
    await expect(resendDelivery(w.client, d)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a delivery stuck while sending goes back if nothing was sent, or to review if the request may have gone out", async () => {
    const w = await world();
    const id = await approved(w);
    await sendReport(w.manager, id, ["a@example.com", "b@example.com"]);
    const a = (await claimNextDelivery())!;
    const b = (await claimNextDelivery())!;
    await markDeliveryRequestSent(b);
    expect(await reapStaleDeliveries(new Date(Date.now() + 12 * 3_600_000))).toBe(2);
    expect((await prisma().reportDelivery.findUniqueOrThrow({ where: { id: a } })).status).toBe(
      "pending",
    );
    expect((await prisma().reportDelivery.findUniqueOrThrow({ where: { id: b } })).status).toBe(
      "needs_review",
    );
  });

  it("does not send a report that is no longer approved", async () => {
    const w = await world();
    const id = await approved(w);
    await sendReport(w.manager, id, ["a@example.com"]);
    await prisma().report.update({ where: { id }, data: { status: "archived" } });
    expect(await claimNextDelivery()).toBeNull();
  });
});

describe("schedule", () => {
  it("computes the next run in the client's time zone and creates one report per period, with delivery after approval", async () => {
    const w = await world();
    const r = await saveSchedule(
      w.manager,
      w.a.id,
      {
        enabled: true,
        intervalDays: 15,
        anchorDate: "2026-11-01",
        sendHour: 9,
        recipients: ["Ann@Example.com"],
        deliverOnApproval: true,
      },
      NOW,
    );
    expect(r.nextRunAt!.toISOString()).toBe("2026-12-01T14:00:00.000Z"); // the Nov 1-15 run (09:00 EST on Nov 16) has already passed at NOW
    expect(r.firstPeriod).toMatchObject({ start: "2026-11-16", end: "2026-11-30" });
    // Not due yet.
    expect(await runDueSchedules()).toEqual({ created: 0, skipped: 0 });
    await prisma()
      .$executeRaw`UPDATE report_schedules SET next_run_at = now() - interval '1 minute'`;
    // Make the anchor far enough back that a period is due on the database clock.
    await prisma().reportSchedule.updateMany({
      data: { anchorDate: new Date("2026-01-01T00:00:00Z") },
    });
    const first = await runDueSchedules();
    expect(first.created).toBe(1);
    expect(await runDueSchedules()).toEqual({ created: 0, skipped: 0 });
    const rep = await prisma().report.findFirstOrThrow({});
    expect(rep.source).toBe("scheduled");
    // Duplicate prevention: creating the same period again returns the same report.
    const { createReportRecord } = await import("./report");
    expect(
      await createReportRecord({
        agencyId: w.a.agencyId,
        clientId: w.a.id,
        start: rep.periodStart.toISOString().slice(0, 10),
        end: rep.periodEnd.toISOString().slice(0, 10),
        source: "scheduled",
        createdById: null,
      }),
    ).toEqual({ id: rep.id, created: false });
    await generateReport(rep.id, null);
    await reviewReport(w.reviewer, rep.id, { decision: "approve" });
    expect((await prisma().reportDelivery.findMany()).map((d) => d.recipient)).toEqual([
      "ann@example.com",
    ]);
  });

  it("validates the schedule and does not run a disabled one", async () => {
    const w = await world();
    await expect(
      saveSchedule(w.manager, w.a.id, { enabled: true, intervalDays: 200, recipients: [] }, NOW),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      saveSchedule(w.manager, w.a.id, { enabled: true, intervalDays: 15, recipients: [] }, NOW),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      saveSchedule(
        w.manager,
        w.a.id,
        { enabled: true, intervalDays: 15, recipients: ["nope"] },
        NOW,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await saveSchedule(
      w.manager,
      w.a.id,
      { enabled: false, intervalDays: 15, recipients: [] },
      NOW,
    );
    expect((await prisma().reportSchedule.findFirstOrThrow({})).nextRunAt).toBeNull();
    expect(await runDueSchedules()).toEqual({ created: 0, skipped: 0 });
    await expect(
      saveSchedule(w.client, w.a.id, { enabled: false, intervalDays: 15, recipients: [] }, NOW),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      saveSchedule(w.outsider, w.a.id, { enabled: false, intervalDays: 15, recipients: [] }, NOW),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
