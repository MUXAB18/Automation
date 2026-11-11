import { beforeEach, describe, expect, it } from "vitest";
import { createTokenCipherForTests } from "../../test/cipher";
import { addMember, makeAgency, makeClient, makeUser, prisma, resetDb } from "../../test/helpers";
import { NotFoundError } from "../errors";
import { connectAccount } from "./integrations";
import {
  getSeoAudits,
  getSeoBacklinks,
  getSeoCompetitors,
  getSeoIssues,
  getSeoKeywords,
  getSeoProjectHeader,
  getSeoTrend,
  listSeoProjects,
} from "./seo-dashboard";
import { linkProviderSeoProject, persistSeRankingRecords } from "./seranking-data";

beforeEach(resetDb);
const cipher = createTokenCipherForTests();
type Rec = { resource: string; externalId: string; data: Record<string, unknown> };
const rec = (resource: string, externalId: string, data: Record<string, unknown>): Rec => ({
  resource,
  externalId,
  data,
});

async function world() {
  const agency = await makeAgency("Agency");
  const other = await makeAgency("Other");
  const a = await makeClient("A", "a", agency.id);
  const b = await makeClient("B", "b", other.id);
  await prisma().integration.create({
    data: { key: "se_ranking", name: "SE Ranking", category: "seo_data", authType: "api_key" },
  });
  const manager = await makeUser();
  await addMember(manager, a.id, "seo_manager");
  const writer = await makeUser();
  await addMember(writer, a.id, "content_writer"); // has seo.view
  const outsider = await makeUser();
  await addMember(outsider, b.id, "seo_manager");
  const base = { agencyId: a.agencyId, clientId: a.id };
  const project = await prisma().project.create({
    data: { ...base, name: "Acme SEO", slug: "acme" },
  });
  const website = await prisma().website.create({ data: { ...base, domain: "acme.ca" } });
  const seo = await prisma().seoProject.create({
    data: { ...base, projectId: project.id, websiteId: website.id },
  });
  const bare = await prisma().seoProject.create({
    data: {
      ...base,
      projectId: (
        await prisma().project.create({ data: { ...base, name: "No provider", slug: "np" } })
      ).id,
      websiteId: (await prisma().website.create({ data: { ...base, domain: "np.ca" } })).id,
    },
  });
  const account = await connectAccount(
    manager,
    {
      clientId: a.id,
      integrationKey: "se_ranking",
      externalAccountId: "seranking",
      credentials: { apiKey: "sr-key-0123456789" },
    },
    cipher,
  );
  const runs = new Map<string, string>();
  const persist = async (records: Rec[], name = "r1") => {
    if (!runs.has(name))
      runs.set(
        name,
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
    return persistSeRankingRecords(
      { ...base, accountId: account.id, syncRunId: runs.get(name)! },
      records,
    );
  };
  await persist([
    rec("projects", "100", {
      name: "acme.ca",
      providerActive: true,
      engines: [{ siteEngineId: 7, regionName: "Canada", langCode: "en" }],
    }),
  ]);
  const provider = await prisma().providerSeoProject.findFirstOrThrow();
  await linkProviderSeoProject(manager, {
    providerProjectId: provider.id,
    seoProjectId: seo.id,
    siteEngineId: 7,
  });
  return { a, b, base, manager, writer, outsider, seo, bare, account, persist };
}

const kw = (id: string, term: string) =>
  rec("keywords", `100:${id}`, { siteId: "100", keywordExternalId: id, term });
const rank = (id: string, date: string, position: number | null, extra = {}) =>
  rec("rankings", `100:${id}:${date}`, {
    siteId: "100",
    keywordExternalId: id,
    date,
    position,
    url: `https://acme.ca/${id}`,
    volume: 100,
    ...extra,
  });

async function seed(w: Awaited<ReturnType<typeof world>>) {
  await w.persist([kw("k1", "alpha"), kw("k2", "beta"), kw("k3", "gamma"), kw("k4", "delta")]);
  await w.persist(
    [
      rank("k1", "2026-03-30", 8),
      rank("k1", "2026-03-31", 4), // improved
      rank("k2", "2026-03-30", 5),
      rank("k2", "2026-03-31", 12), // declined
      rank("k3", "2026-03-31", null), // tracked, not ranking
      // k4: no reading at all
    ],
    "r2",
  );
}

describe("project header", () => {
  it("computes headline numbers from stored readings only", async () => {
    const w = await world();
    await seed(w);
    const h = await getSeoProjectHeader(w.manager, w.seo.id);
    expect(h).toMatchObject({ name: "Acme SEO", domain: "acme.ca" });
    expect(h.stats).toMatchObject({
      keywords: 4,
      withReading: 3,
      ranked: 2,
      top3: 0,
      top10: 1,
      improved: 1,
      declined: 1,
      lastReadingDay: "2026-03-31",
    });
    expect(h.stats.avgPosition).toBe(8);
    expect(h.provider).toMatchObject({
      name: "acme.ca",
      isMock: false,
      syncEnabled: true,
      engine: { regionName: "Canada" },
    });
    expect(h.provider?.lastSuccessfulSyncAt).not.toBeNull();
  });

  it("says so when no provider is linked, instead of inventing numbers", async () => {
    const w = await world();
    const h = await getSeoProjectHeader(w.manager, w.bare.id);
    expect(h.provider).toBeNull();
    expect(h.stats).toMatchObject({
      keywords: 0,
      ranked: 0,
      avgPosition: null,
      lastReadingDay: null,
    });
    expect(h.latestAudit).toBeNull();
    expect(h.backlinks).toBeNull();
  });

  it("is scoped: other tenants cannot see it, same-client readers can", async () => {
    const w = await world();
    await expect(getSeoProjectHeader(w.outsider, w.seo.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getSeoKeywords(w.outsider, w.seo.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getSeoTrend(w.outsider, w.seo.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getSeoProjectHeader(w.writer, w.seo.id)).resolves.toBeTruthy();
  });
});

describe("keywords and trend", () => {
  it("lists keywords with latest position, change vs the previous reading, volume and history", async () => {
    const w = await world();
    await seed(w);
    const page = await getSeoKeywords(w.manager, w.seo.id);
    const by = Object.fromEntries(page.rows.map((r) => [r.term, r]));
    expect(by.alpha).toMatchObject({
      position: 4,
      change: 4,
      volume: 100,
      url: "https://acme.ca/k1",
      checkedOn: "2026-03-31",
      source: "se_ranking",
      provider: "se_ranking",
    });
    expect(by.alpha!.series.map((s) => s.position)).toEqual([8, 4]);
    expect(by.beta).toMatchObject({ position: 12, change: -7 });
    expect(by.gamma).toMatchObject({ position: null, change: null, checkedOn: "2026-03-31" });
    expect(by.delta).toMatchObject({ position: null, checkedOn: null });
    expect(
      (await getSeoKeywords(w.manager, w.seo.id, { q: "ALP" })).rows.map((r) => r.term),
    ).toEqual(["alpha"]);
  });

  it("builds a per-day trend from the latest reading of each keyword", async () => {
    const w = await world();
    await seed(w);
    await w.persist([rank("k2", "2026-03-31", 9)], "r3"); // revised reading: the latest one wins
    const trend = await getSeoTrend(w.manager, w.seo.id, 365);
    expect(trend).toEqual([
      { day: "2026-03-30", avgPosition: 6.5, top10: 2, ranked: 2, tracked: 2 },
      { day: "2026-03-31", avgPosition: 6.5, top10: 2, ranked: 2, tracked: 3 },
    ]);
  });
});

describe("audits, issues, competitors, backlinks", () => {
  it("shows audit history, filters issues, and reports competitors and backlink totals as stored", async () => {
    const w = await world();
    const check = (code: string, status: string, pages: number) =>
      rec("audit_issues", `100:${code}`, {
        siteId: "100",
        auditExternalId: "A2",
        code,
        name: `Check ${code}`,
        section: "Meta",
        status,
        pagesAffected: pages,
        sampleUrls: ["https://acme.ca/x"],
      });
    await w.persist([
      rec("audits", "100:A1", {
        siteId: "100",
        auditExternalId: "A1",
        status: "finished",
        lastUpdate: "2026-02-01",
        score: 70,
        errors: 5,
        warnings: 1,
        notices: 0,
        crawled: 90,
      }),
      rec("audits", "100:A2", {
        siteId: "100",
        auditExternalId: "A2",
        status: "finished",
        lastUpdate: "2026-03-01",
        score: 82,
        errors: 2,
        warnings: 3,
        notices: 4,
        crawled: 120,
      }),
      check("e1", "error", 4),
      check("w1", "warning", 9),
      check("n1", "notice", 1),
      rec("audit_reports", "100:A2", {
        siteId: "100",
        auditExternalId: "A2",
        checks: 3,
        score: 82,
        pages: 120,
      }),
      rec("competitors", "100:5", {
        siteId: "100",
        competitorExternalId: "5",
        name: "Rival",
        url: "https://rival.com",
        domainTrust: 40,
      }),
      rec("backlinks", "100:stats", {
        siteId: "100",
        total: 500,
        domains: 80,
        anchors: 30,
        ip: 70,
        dofollow: 300,
        nofollow: 200,
        remainingDailyAdds: 450,
      }),
    ]);
    const header = await getSeoProjectHeader(w.manager, w.seo.id);
    expect(header.latestAudit).toMatchObject({
      healthScore: 82,
      pagesCrawled: 120,
      externalSource: "se_ranking",
    });
    expect(header.issues).toEqual({ high: 1, medium: 1, low: 1 });
    expect(header.competitors).toBe(1);
    expect(header.backlinks).toMatchObject({
      totalBacklinks: 500,
      referringDomains: 80,
      source: "se_ranking",
    });

    const audits = await getSeoAudits(w.manager, w.seo.id);
    expect(audits.map((a) => a.healthScore)).toEqual([82, 70]);
    const all = await getSeoIssues(w.manager, w.seo.id);
    expect(all.rows.map((r) => r.severity)).toEqual(["high", "medium", "low"]);
    expect(all.rows[0]!.details).toMatchObject({
      pagesAffected: 4,
      sampleUrls: ["https://acme.ca/x"],
    });
    expect(
      (await getSeoIssues(w.manager, w.seo.id, { severity: "medium" })).rows.map((r) => r.ruleKey),
    ).toEqual(["w1"]);
    expect((await getSeoIssues(w.manager, w.seo.id, { status: "fixed" })).total).toBe(0);
    expect(await getSeoCompetitors(w.manager, w.seo.id)).toEqual([
      expect.objectContaining({
        domain: "rival.com",
        providerData: expect.objectContaining({ domainTrust: 40 }),
      }),
    ]);
    expect(await getSeoBacklinks(w.manager, w.seo.id)).toEqual([
      expect.objectContaining({
        totalBacklinks: 500,
        raw: expect.objectContaining({ nofollow: 200 }),
      }),
    ]);
  });
});

describe("project list", () => {
  it("lists only what the person may see, and can be limited to a client", async () => {
    const w = await world();
    const mine = await listSeoProjects(w.manager);
    expect(mine.map((p) => p.name).sort()).toEqual(["Acme SEO", "No provider"]);
    expect(mine.find((p) => p.name === "Acme SEO")!.providerLinked).toBe(true);
    expect(await listSeoProjects(w.manager, w.b.id)).toEqual([]);
    expect(await listSeoProjects(w.outsider)).toEqual([]);
  });
});
