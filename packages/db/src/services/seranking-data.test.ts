import { beforeEach, describe, expect, it } from "vitest";
import { createTokenCipherForTests } from "../../test/cipher";
import { addMember, makeAgency, makeClient, makeUser, prisma, resetDb } from "../../test/helpers";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { connectAccount } from "./integrations";
import {
  domainOf,
  linkProviderSeoProject,
  listProviderSeoProjects,
  loadSeRankingSettings,
  persistSeRankingRecords,
  unlinkProviderSeoProject,
} from "./seranking-data";

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
  const specialist = await makeUser();
  await addMember(specialist, a.id, "seo_specialist");
  const outsider = await makeUser();
  await addMember(outsider, b.id, "seo_manager");
  const base = { agencyId: a.agencyId, clientId: a.id };
  const mkSeo = async (slug: string) => {
    const project = await prisma().project.create({ data: { ...base, name: `P ${slug}`, slug } });
    const website = await prisma().website.create({ data: { ...base, domain: `${slug}.ca` } });
    return prisma().seoProject.create({
      data: {
        ...base,
        projectId: project.id,
        websiteId: website.id,
        targetCountry: "CA",
        targetLanguage: "en",
      },
    });
  };
  const seo = await mkSeo("acme");
  const seo2 = await mkSeo("second");
  const account = await connectAccount(
    manager,
    {
      clientId: a.id,
      integrationKey: "se_ranking",
      externalAccountId: "seranking",
      credentials: { apiKey: "sr-key-0123456789" },
      hintField: "apiKey",
    },
    cipher,
  );
  // Snapshots reference real sync runs (foreign key), so each named run is created once.
  const runs = new Map<string, string>();
  const run = async (name = "run1") => {
    if (!runs.has(name)) {
      const created = await prisma().syncRun.create({
        data: { ...base, integrationAccountId: account.id, status: "succeeded" },
      });
      runs.set(name, created.id);
    }
    return { ...base, accountId: account.id, syncRunId: runs.get(name)! };
  };
  const persist = async (records: Rec[], name = "run1") =>
    persistSeRankingRecords(await run(name), records);
  const discover = () =>
    persist([
      rec("projects", "100", {
        name: "https://www.Acme.ca/",
        title: "Acme",
        providerActive: true,
        keywordCount: 3,
        engines: [
          { siteEngineId: 7, regionName: "Canada", langCode: "en" },
          { siteEngineId: 8, regionName: "USA", langCode: "en" },
        ],
      }),
    ]);
  await discover();
  const provider = await prisma().providerSeoProject.findFirstOrThrow();
  const link = () =>
    linkProviderSeoProject(manager, {
      providerProjectId: provider.id,
      seoProjectId: seo.id,
      siteEngineId: 7,
    });
  return {
    a,
    b,
    base,
    manager,
    specialist,
    outsider,
    seo,
    seo2,
    account,
    provider,
    persist,
    discover,
    link,
    run,
  };
}

describe("project discovery and linking", () => {
  it("discovers a project once, and nothing is synced until a person links it", async () => {
    const w = await world();
    await w.discover();
    expect(await prisma().providerSeoProject.count()).toBe(1);
    expect(
      await w.persist([
        rec("keywords", "100:k1", { siteId: "100", keywordExternalId: "k1", term: "x" }),
      ]),
    ).toBe(0);
    expect(await prisma().keyword.count()).toBe(0);
    expect((await loadSeRankingSettings(w.account.id)).projects).toEqual([]);
  });

  it("links with permission, validates the engine and the SEO project, and exposes the settings the adapter needs", async () => {
    const w = await world();
    await expect(
      linkProviderSeoProject(w.specialist, {
        providerProjectId: w.provider.id,
        seoProjectId: w.seo.id,
        siteEngineId: 7,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      linkProviderSeoProject(w.outsider, {
        providerProjectId: w.provider.id,
        seoProjectId: w.seo.id,
        siteEngineId: 7,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      linkProviderSeoProject(w.manager, {
        providerProjectId: w.provider.id,
        seoProjectId: w.seo.id,
        siteEngineId: 99,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await w.link();
    expect(await loadSeRankingSettings(w.account.id)).toEqual({
      projects: [{ siteId: "100", siteEngineId: 7, rankingsThrough: null }],
    });
    const list = await listProviderSeoProjects(w.manager, w.account.id);
    expect(list.canLink).toBe(true);
    expect(list.candidates.map((c) => c.id)).toEqual([w.seo2.id]);
    expect((await listProviderSeoProjects(w.specialist, w.account.id)).canLink).toBe(false);
  });

  it("refuses to link one SEO project to two provider projects, and unlinking keeps imported data", async () => {
    const w = await world();
    await w.link();
    await w.persist([
      rec("projects", "200", {
        name: "other.ca",
        providerActive: true,
        engines: [{ siteEngineId: 1 }],
      }),
    ]);
    const second = await prisma().providerSeoProject.findFirstOrThrow({
      where: { externalId: "200" },
    });
    await expect(
      linkProviderSeoProject(w.manager, {
        providerProjectId: second.id,
        seoProjectId: w.seo.id,
        siteEngineId: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await w.persist([
      rec("keywords", "100:k1", { siteId: "100", keywordExternalId: "k1", term: "Freight" }),
    ]);
    await unlinkProviderSeoProject(w.manager, w.provider.id);
    expect(await prisma().keyword.count()).toBe(1);
    expect((await loadSeRankingSettings(w.account.id)).projects).toEqual([]);
    expect(
      await prisma().auditLog.count({
        where: { action: { in: ["seranking.project_linked", "seranking.project_unlinked"] } },
      }),
    ).toBe(2);
  });

  it("stops syncing a project the provider no longer has", async () => {
    const w = await world();
    await w.link();
    await w.persist([rec("project_missing", "100", { siteId: "100" })]);
    expect((await loadSeRankingSettings(w.account.id)).projects).toEqual([]);
    expect(
      (await prisma().providerSeoProject.findUniqueOrThrow({ where: { id: w.provider.id } }))
        .providerActive,
    ).toBe(false);
  });
});

const kw = (id: string, term: string, extra = {}) =>
  rec("keywords", `100:${id}`, {
    siteId: "100",
    keywordExternalId: id,
    term,
    targetUrl: null,
    ...extra,
  });
const rank = (id: string, date: string, position: number | null, extra = {}) =>
  rec("rankings", `100:${id}:${date}`, {
    siteId: "100",
    keywordExternalId: id,
    date,
    position,
    url: null,
    volume: null,
    ...extra,
  });

describe("keywords and ranking history", () => {
  it("imports keywords once, normalises terms, and adopts a keyword someone already added by hand", async () => {
    const w = await world();
    await w.link();
    await prisma().keyword.create({
      data: {
        ...w.base,
        seoProjectId: w.seo.id,
        term: "freight forwarding",
        country: "CA",
        locale: "en",
      },
    });
    await w.persist([
      kw("k1", "  Freight   Forwarding "),
      kw("k2", "Customs Broker", { targetUrl: "https://acme.ca/c" }),
    ]);
    await w.persist(
      [
        kw("k1", "Freight Forwarding"),
        kw("k2", "Customs Broker", { targetUrl: "https://acme.ca/c2" }),
      ],
      "run2",
    );
    const rows = await prisma().keyword.findMany({ orderBy: { term: "asc" } });
    expect(rows.map((r) => [r.term, r.externalSource, r.externalId, r.targetUrl])).toEqual([
      ["customs broker", "se_ranking", "k2", "https://acme.ca/c2"],
      ["freight forwarding", "se_ranking", "k1", null],
    ]);
    expect(rows.every((r) => r.country === "CA" && r.device === "desktop")).toBe(true);
  });

  it("keeps history: new days append, identical re-imports add nothing, revised readings add a row and the latest wins", async () => {
    const w = await world();
    await w.link();
    await w.persist([kw("k1", "freight")]);
    const first = await w.persist(
      [
        rank("k1", "2026-03-29", 8, { volume: 900, url: "https://acme.ca/f" }),
        rank("k1", "2026-03-30", null),
      ],
      "r1",
    );
    expect(first).toBe(2);
    expect(
      await w.persist([rank("k1", "2026-03-29", 8), rank("k1", "2026-03-30", null)], "r2"),
    ).toBe(0);
    expect(await w.persist([rank("k1", "2026-03-30", 5), rank("k1", "2026-03-31", 4)], "r3")).toBe(
      2,
    );
    const snaps = await prisma().keywordRankSnapshot.findMany({
      orderBy: [{ checkedOn: "asc" }, { capturedAt: "asc" }],
    });
    expect(
      snaps.map((s) => [
        s.checkedOn.toISOString().slice(0, 10),
        s.position === null ? null : s.position.toNumber(),
        s.source,
      ]),
    ).toEqual([
      ["2026-03-29", 8, "se_ranking"],
      ["2026-03-30", null, "se_ranking"],
      ["2026-03-30", 5, "se_ranking"],
      ["2026-03-31", 4, "se_ranking"],
    ]);
    const keyword = await prisma().keyword.findFirstOrThrow();
    expect(keyword.searchVolume).toBe(900);
    expect(
      (
        await prisma().providerSeoProject.findUniqueOrThrow({ where: { id: w.provider.id } })
      ).rankingsThrough
        ?.toISOString()
        .slice(0, 10),
    ).toBe("2026-03-31");
    expect((await loadSeRankingSettings(w.account.id)).projects[0]!.rankingsThrough).toBe(
      "2026-03-31",
    );
  });

  it("ignores rankings for keywords that were not imported and never moves 'through' backwards", async () => {
    const w = await world();
    await w.link();
    await w.persist([kw("k1", "freight")]);
    await w.persist([rank("k1", "2026-03-31", 3), rank("ghost", "2026-04-05", 1)]);
    await w.persist([rank("k1", "2026-03-01", 9)], "r2");
    expect(
      (
        await prisma().providerSeoProject.findUniqueOrThrow({ where: { id: w.provider.id } })
      ).rankingsThrough
        ?.toISOString()
        .slice(0, 10),
    ).toBe("2026-03-31");
    expect(await prisma().keywordRankSnapshot.count()).toBe(2);
  });
});

const check = (code: string, status: string, pages = 3, extra = {}) =>
  rec("audit_issues", `100:${code}`, {
    siteId: "100",
    auditExternalId: "A1",
    code,
    name: `Check ${code}`,
    section: "Meta",
    status,
    pagesAffected: pages,
    sampleUrls: ["https://acme.ca/x"],
    ...extra,
  });
const marker = (audit = "A1", checks = 3) =>
  rec("audit_reports", `100:${audit}`, {
    siteId: "100",
    auditExternalId: audit,
    checks,
    score: 80,
    pages: 120,
  });
const auditRow = (id: string, over = {}) =>
  rec("audits", `100:${id}`, {
    siteId: "100",
    auditExternalId: id,
    title: "Acme",
    url: "acme.ca",
    status: "finished",
    lastUpdate: "2026-03-15",
    score: 80,
    errors: 2,
    warnings: 3,
    notices: 4,
    crawled: 120,
    ...over,
  });

describe("site audits and issues", () => {
  it("stores audits by provider id with source metadata, and updates them when re-imported", async () => {
    const w = await world();
    await w.link();
    await w.persist([auditRow("A1", { status: "processing", score: null })]);
    await w.persist([auditRow("A1")], "r2");
    const rows = await prisma().siteAudit.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      externalSource: "se_ranking",
      externalId: "A1",
      status: "completed",
      pagesCrawled: 120,
    });
    expect(Number(rows[0]!.healthScore)).toBe(80);
    expect(rows[0]!.summary).toMatchObject({
      source: "se_ranking",
      errors: 2,
      providerStatus: "finished",
    });
  });

  it("creates each issue once with the right severity, never creates passed checks, and re-imports do not duplicate or add history", async () => {
    const w = await world();
    await w.link();
    const report = [
      check("title_missing", "error"),
      check("desc_long", "warning"),
      check("alt_missing", "notice"),
      check("h1_ok", "passed", 0),
      marker("A1", 4),
    ];
    await w.persist([auditRow("A1"), ...report]);
    await w.persist(report, "r2");
    const issues = await prisma().seoIssue.findMany({ orderBy: { ruleKey: "asc" } });
    expect(
      issues.map((i) => [i.ruleKey, i.severity, i.status, i.externalSource, i.fingerprint]),
    ).toEqual([
      ["alt_missing", "low", "open", "se_ranking", "se_ranking:alt_missing"],
      ["desc_long", "medium", "open", "se_ranking", "se_ranking:desc_long"],
      ["title_missing", "high", "open", "se_ranking", "se_ranking:title_missing"],
    ]);
    expect(issues[2]!.details).toMatchObject({
      pagesAffected: 3,
      sampleUrls: ["https://acme.ca/x"],
      source: "se_ranking",
    });
    expect(await prisma().seoIssueHistory.count()).toBe(3);
  });

  it("marks issues fixed when the latest audit no longer reports them, reopens them if they return, and keeps human decisions", async () => {
    const w = await world();
    await w.link();
    await w.persist([
      auditRow("A1"),
      check("a", "error"),
      check("b", "warning"),
      check("c", "error"),
      marker(),
    ]);
    const c = await prisma().seoIssue.findFirstOrThrow({ where: { ruleKey: "c" } });
    await prisma().seoIssue.update({ where: { id: c.id }, data: { status: "ignored" } });
    // a vanishes, b is now passed, c stays reported-nowhere but was ignored by a person
    await w.persist(
      [
        auditRow("A2"),
        check("b", "passed", 0, { auditExternalId: "A2" }),
        check("z", "notice", 1, { auditExternalId: "A2" }),
        marker("A2", 2),
      ],
      "r2",
    );
    const status = async (k: string) =>
      (await prisma().seoIssue.findFirstOrThrow({ where: { ruleKey: k } })).status;
    expect(await status("a")).toBe("fixed");
    expect(await status("b")).toBe("fixed");
    expect(await status("c")).toBe("ignored");
    expect(await status("z")).toBe("open");
    expect(
      (await prisma().seoIssue.findFirstOrThrow({ where: { ruleKey: "a" } })).resolvedAt,
    ).not.toBeNull();
    await w.persist(
      [auditRow("A3"), check("a", "error", 7, { auditExternalId: "A3" }), marker("A3", 1)],
      "r3",
    );
    expect(await status("a")).toBe("reopened");
    const history = await prisma().seoIssueHistory.findMany({
      where: { seoIssue: { ruleKey: "a" } },
      orderBy: { createdAt: "asc" },
    });
    expect(history.map((h) => h.toStatus)).toEqual(["open", "fixed", "reopened"]);
    expect(await prisma().seoIssue.count({ where: { ruleKey: "a" } })).toBe(1);
  });

  it("never resolves anything from an empty report", async () => {
    const w = await world();
    await w.link();
    await w.persist([auditRow("A1"), check("a", "error"), marker("A1", 1)]);
    await w.persist([auditRow("A2"), marker("A2", 0)], "r2");
    expect((await prisma().seoIssue.findFirstOrThrow({ where: { ruleKey: "a" } })).status).toBe(
      "open",
    );
  });
});

describe("competitors, backlinks and summary", () => {
  it("adopts a competitor already added by domain, updates by provider id, and does not duplicate", async () => {
    const w = await world();
    await w.link();
    await prisma().competitor.create({
      data: { ...w.base, seoProjectId: w.seo.id, domain: "rival.com", notes: "mine" },
    });
    const c = (trust: number) =>
      rec("competitors", "100:5", {
        siteId: "100",
        competitorExternalId: "5",
        name: "Rival",
        url: "https://www.Rival.com/x",
        domainTrust: trust,
      });
    await w.persist([
      c(40),
      rec("competitors", "100:6", {
        siteId: "100",
        competitorExternalId: "6",
        name: null,
        url: null,
        domainTrust: 1,
      }),
    ]);
    await w.persist([c(44)], "r2");
    const rows = await prisma().competitor.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      domain: "rival.com",
      externalSource: "se_ranking",
      externalId: "5",
      notes: "mine",
      name: "Rival",
    });
    expect(rows[0]!.providerData).toMatchObject({ domainTrust: 44 });
  });

  it("stores one backlink reading per sync run as reported, and skips totals the provider did not give", async () => {
    const w = await world();
    await w.link();
    const run = await prisma().syncRun.create({
      data: { ...w.base, integrationAccountId: w.account.id, status: "running" },
    });
    const stats = rec("backlinks", "100:stats", {
      siteId: "100",
      total: 500,
      domains: 80,
      anchors: 30,
      ip: 70,
      dofollow: 300,
      nofollow: 200,
      remainingDailyAdds: 450,
    });
    await persistSeRankingRecords({ ...w.base, accountId: w.account.id, syncRunId: run.id }, [
      stats,
      stats,
    ]);
    await persistSeRankingRecords({ ...w.base, accountId: w.account.id, syncRunId: run.id }, [
      rec("backlinks", "100:stats", { siteId: "100", total: null }),
    ]);
    const rows = await prisma().backlinkSnapshot.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "se_ranking",
      subjectDomain: "acme.ca",
      totalBacklinks: 500,
      referringDomains: 80,
      syncRunId: run.id,
    });
    expect(rows[0]!.raw).toMatchObject({ nofollow: 200 });
  });

  it("keeps the provider summary exactly as reported", async () => {
    const w = await world();
    await w.link();
    await w.persist([
      rec("project_summary", "100", {
        siteId: "100",
        summary: { top10: 12, visibility_percent: 34.5, da: null },
      }),
    ]);
    const row = await prisma().providerSeoProject.findUniqueOrThrow({
      where: { id: w.provider.id },
    });
    expect(row.summary).toEqual({ top10: 12, visibility_percent: 34.5, da: null });
    expect(row.summaryAt).not.toBeNull();
  });
});

describe("helpers", () => {
  it("extracts a clean domain", () => {
    expect(domainOf("https://www.Acme.ca/path?x=1")).toBe("acme.ca");
    expect(domainOf("rival.com")).toBe("rival.com");
    expect(domainOf("")).toBeNull();
    expect(domainOf(null)).toBeNull();
  });
});
