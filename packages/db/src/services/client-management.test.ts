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
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { getBrandGuidelines, saveBrandGuideline } from "./brand";
import {
  canCreateClients,
  createClient,
  getClient,
  getClientSummary,
  searchClients,
  setAccountOwner,
  setClientStatus,
  updateClient,
} from "./clients";
import { addClientMember, listClientTeam, removeClientMember } from "./team";

beforeEach(resetDb);

const base = { name: "Acme Freight", reportIntervalDays: 15 };
const fieldErrors = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ValidationError);
  return (error as ValidationError).fieldErrors;
};

async function world() {
  const agencyA = await makeAgency("Agency A");
  const agencyB = await makeAgency("Agency B");
  const adminA = await makeUser();
  await addAgencyStaff(adminA, agencyA.id, "agency_admin", true);
  const adminB = await makeUser();
  await addAgencyStaff(adminB, agencyB.id, "agency_admin", true);
  const platform = await makeUser(true);
  return { agencyA, agencyB, adminA, adminB, platform };
}

describe("creating a client", () => {
  it("stores the whole profile, the website and an audit entry together", async () => {
    const { adminA, agencyA } = await world();
    const client = await createClient(adminA, {
      ...base,
      primaryDomain: "https://Acme.ca/about",
      industry: " Logistics ",
      goals: "Rank for freight keywords",
      targetLocations: "Ottawa, ON\nToronto, ON;  ottawa, on",
      timezone: "America/Toronto",
      locale: "fr-CA",
      reportEmail: "ops@acme.ca",
      reportIntervalDays: 30,
      preferences: { reportDelivery: "download", reportWeekday: 2, weeklySummary: "on" } as never,
    });
    const stored = await prisma().client.findUniqueOrThrow({
      where: { id: client.id },
      include: { websites: true },
    });
    expect(stored).toMatchObject({
      agencyId: agencyA.id,
      industry: "Logistics",
      goals: "Rank for freight keywords",
      targetLocations: ["Ottawa, ON", "Toronto, ON"],
      timezone: "America/Toronto",
      locale: "fr-CA",
      reportIntervalDays: 30,
      accountOwnerId: adminA.userId,
    });
    expect(stored.websites.map((w) => w.domain)).toEqual(["acme.ca"]);
    expect((stored.settings as { preferences: object }).preferences).toEqual({
      reportDelivery: "download",
      reportWeekday: 2,
      weeklySummary: true,
    });
    const [audit] = await prisma().auditLog.findMany({ where: { action: "client.created" } });
    expect(audit).toMatchObject({
      clientId: client.id,
      agencyId: agencyA.id,
      actorUserId: adminA.userId,
    });
  });

  it("validates every field and reports them by name", async () => {
    const { adminA } = await world();
    const errors = await fieldErrors(
      createClient(adminA, {
        name: " ",
        timezone: "Mars/Olympus",
        reportEmail: "not-an-email",
        reportIntervalDays: 0,
        goals: "x".repeat(4001),
        industry: "y".repeat(121),
        targetLocations: Array.from({ length: 26 }, (_, i) => `Place ${i}`),
        locale: "xx-XX" as never,
        primaryDomain: "not a domain",
      }),
    );
    expect(Object.keys(errors).sort()).toEqual([
      "goals",
      "industry",
      "locale",
      "name",
      "primaryDomain",
      "reportEmail",
      "reportIntervalDays",
      "targetLocations",
      "timezone",
    ]);
  });

  it("is all-or-nothing: a rejected slug or owner leaves nothing behind", async () => {
    const { adminA, agencyA } = await world();
    await makeClient("Taken", "taken", agencyA.id);
    await expect(
      createClient(adminA, { ...base, slug: "taken", primaryDomain: "acme.ca" }),
    ).rejects.toBeInstanceOf(ConflictError);
    const stranger = await makeUser();
    expect(
      (await fieldErrors(createClient(adminA, { ...base, accountOwnerId: stranger.userId })))
        .accountOwnerId,
    ).toBeDefined();
    expect(await prisma().client.count({ where: { agencyId: agencyA.id } })).toBe(1);
    expect(await prisma().website.count()).toBe(0);
  });

  it("lets an Agency Admin create clients only inside their own agency", async () => {
    const { adminA, adminB, agencyA, agencyB } = await world();
    expect(await canCreateClients(adminA)).toBe(true);
    const mine = await createClient(adminA, base);
    expect(mine.agencyId).toBe(agencyA.id);
    await expect(createClient(adminA, { ...base, agencyId: agencyB.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await createClient(adminB, { ...base, name: "Other" })).agencyId).toBe(agencyB.id);
  });

  it("refuses people without client.create", async () => {
    const { agencyA } = await world();
    const manager = await makeUser();
    await addAgencyStaff(manager, agencyA.id, "seo_manager", true);
    const nobody = await makeUser();
    expect(await canCreateClients(manager)).toBe(false);
    await expect(createClient(manager, base)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createClient(nobody, base)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("editing a client", () => {
  it("updates the profile, keeps unrelated settings, and audits before/after", async () => {
    const { adminA, agencyA } = await world();
    const client = await prisma().client.create({
      data: { agencyId: agencyA.id, name: "A", slug: "acme", settings: { custom: 1 } },
    });
    await updateClient(adminA, client.id, {
      name: "A Renamed",
      slug: "acme",
      industry: "Retail",
      targetLocations: ["Canada"],
      timezone: "America/Vancouver",
      reportIntervalDays: 7,
    } as never);
    const after = await prisma().client.findUniqueOrThrow({ where: { id: client.id } });
    expect(after).toMatchObject({
      name: "A Renamed",
      industry: "Retail",
      timezone: "America/Vancouver",
      reportIntervalDays: 7,
    });
    expect(after.settings).toMatchObject({ custom: 1, preferences: { reportDelivery: "email" } });
    const [audit] = await prisma().auditLog.findMany({ where: { action: "client.updated" } });
    expect((audit?.before as { name: string }).name).toBe("A");
    expect((audit?.after as { name: string }).name).toBe("A Renamed");
  });

  it("enforces client.update and tenant boundaries", async () => {
    const { agencyA, adminB } = await world();
    const client = await makeClient("A", "acme", agencyA.id);
    const reviewer = await makeUser();
    await addMember(reviewer, client.id, "reviewer");
    const manager = await makeUser();
    await addMember(manager, client.id, "seo_manager");
    const input = { name: "Hacked", slug: "acme" } as never;
    await expect(updateClient(reviewer, client.id, input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateClient(adminB, client.id, input)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateClient(manager, client.id, { name: "Fine", slug: "acme" } as never),
    ).resolves.toBeTruthy();
    expect((await prisma().client.findUniqueOrThrow({ where: { id: client.id } })).name).toBe(
      "Fine",
    );
  });

  it("archives and restores, recording when", async () => {
    const { adminA, agencyA } = await world();
    const client = await makeClient("A", "acme", agencyA.id);
    await setClientStatus(adminA, client.id, "archived");
    expect(
      (await prisma().client.findUniqueOrThrow({ where: { id: client.id } })).archivedAt,
    ).not.toBeNull();
    expect((await searchClients(adminA, { status: "archived" })).total).toBe(1);
    await setClientStatus(adminA, client.id, "active");
    expect(
      (await prisma().client.findUniqueOrThrow({ where: { id: client.id } })).archivedAt,
    ).toBeNull();
    const manager = await makeUser();
    await addMember(manager, client.id, "seo_manager");
    await expect(setClientStatus(manager, client.id, "archived")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("account owner and team", () => {
  it("only accepts someone who works on the client, and the database agrees", async () => {
    const { agencyA, adminA, adminB } = await world();
    const client = await makeClient("A", "acme", agencyA.id);
    const worker = await makeUser();
    await addMember(worker, client.id, "seo_specialist");
    const stranger = await makeUser();

    await setAccountOwner(adminA, client.id, worker.userId);
    expect(
      (await prisma().client.findUniqueOrThrow({ where: { id: client.id } })).accountOwnerId,
    ).toBe(worker.userId);
    expect(
      (await fieldErrors(setAccountOwner(adminA, client.id, stranger.userId))).accountOwnerId,
    ).toBeDefined();
    expect(
      (await fieldErrors(setAccountOwner(adminA, client.id, adminB.userId))).accountOwnerId,
    ).toBeDefined();
    // Skipping the service does not help: the trigger refuses too.
    await expect(
      prisma().client.update({
        where: { id: client.id },
        data: { accountOwnerId: stranger.userId },
      }),
    ).rejects.toThrow(/no access/);
    await setAccountOwner(adminA, client.id, null);
    expect(
      (await prisma().client.findUniqueOrThrow({ where: { id: client.id } })).accountOwnerId,
    ).toBeNull();
  });

  it("requires member.manage and stays inside the tenant", async () => {
    const { agencyA, adminB } = await world();
    const client = await makeClient("A", "acme", agencyA.id);
    const reviewer = await makeUser();
    await addMember(reviewer, client.id, "reviewer");
    await expect(setAccountOwner(reviewer, client.id, reviewer.userId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(setAccountOwner(adminB, client.id, null)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("clears the owner when they are taken off the client", async () => {
    const { agencyA, adminA } = await world();
    const client = await makeClient("A", "acme", agencyA.id);
    const worker = await makeUser();
    await addMember(worker, client.id, "seo_specialist");
    await setAccountOwner(adminA, client.id, worker.userId);
    await removeClientMember(adminA, client.id, worker.userId);
    expect(
      (await prisma().client.findUniqueOrThrow({ where: { id: client.id } })).accountOwnerId,
    ).toBeNull();
  });

  it("adds existing agency members to the client team with roles, never outsiders", async () => {
    const { agencyA, adminA, adminB } = await world();
    const client = await makeClient("A", "acme", agencyA.id);
    const colleague = await makeUser();
    await addAgencyStaff(colleague, agencyA.id, "content_writer");
    await addClientMember(adminA, {
      clientId: client.id,
      userId: colleague.userId,
      roleKeys: ["content_writer", "reviewer"],
    });
    const team = await listClientTeam(adminA, client.id);
    expect(team.members.map((m) => m.roles.map((r) => r.key).sort())).toEqual([
      ["content_writer", "reviewer"],
    ]);
    expect(team.candidates.map((c) => c.userId)).not.toContain(colleague.userId);
    await expect(
      addClientMember(adminA, {
        clientId: client.id,
        userId: colleague.userId,
        roleKeys: ["reviewer"],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      addClientMember(adminA, {
        clientId: client.id,
        userId: adminB.userId,
        roleKeys: ["reviewer"],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const manager = await makeUser();
    await addMember(manager, client.id, "seo_manager");
    const another = await makeUser();
    await addAgencyStaff(another, agencyA.id, "reviewer");
    await expect(
      addClientMember(manager, {
        clientId: client.id,
        userId: another.userId,
        roleKeys: ["agency_admin"],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      (await prisma().auditLog.findMany({ where: { action: "membership.added" } })).length,
    ).toBe(1);
  });

  it("shows candidates only to people who can manage access", async () => {
    const { agencyA } = await world();
    const client = await makeClient("A", "acme", agencyA.id);
    const writer = await makeUser();
    await addMember(writer, client.id, "content_writer");
    const team = await listClientTeam(writer, client.id);
    expect(team.canManage).toBe(false);
    expect(team.candidates).toEqual([]);
    expect(team.roles).toEqual([]);
  });
});

describe("searching clients", () => {
  it("searches name, industry and website; filters status and owner; pages", async () => {
    const { adminA, agencyA } = await world();
    for (let i = 0; i < 23; i++)
      await makeClient(`Bulk ${String(i).padStart(2, "0")}`, `bulk-${i}`, agencyA.id);
    const special = await prisma().client.create({
      data: {
        agencyId: agencyA.id,
        name: "Zed",
        slug: "zed",
        industry: "Shipping",
        status: "paused",
        accountOwnerId: adminA.userId,
      },
    });
    await prisma().website.create({
      data: {
        agencyId: agencyA.id,
        clientId: special.id,
        domain: "zed-freight.ca",
        isPrimary: true,
      },
    });

    const first = await searchClients(adminA);
    expect(first).toMatchObject({ total: 24, pageCount: 2 });
    expect(first.rows).toHaveLength(20);
    expect((await searchClients(adminA, { page: 2 })).rows).toHaveLength(4);
    expect((await searchClients(adminA, { q: "shipping" })).rows.map((c) => c.id)).toEqual([
      special.id,
    ]);
    expect((await searchClients(adminA, { q: "ZED-FREIGHT" })).rows.map((c) => c.id)).toEqual([
      special.id,
    ]);
    expect((await searchClients(adminA, { status: "paused" })).total).toBe(1);
    expect((await searchClients(adminA, { owner: "me" })).rows.map((c) => c.id)).toEqual([
      special.id,
    ]);
    expect((await searchClients(adminA, { q: "'; drop table clients;--" })).total).toBe(0);
  });

  it("only shows the actor's own clients and flags where they may archive", async () => {
    const { agencyA, agencyB } = await world();
    const mine = await makeClient("Mine", "mine", agencyA.id);
    await makeClient("Theirs", "theirs", agencyB.id);
    const manager = await makeUser();
    await addMember(manager, mine.id, "seo_manager");
    const result = await searchClients(manager);
    expect(result.rows.map((c) => c.name)).toEqual(["Mine"]);
    expect(result.rows[0]?.canArchive).toBe(false);
  });
});

describe("client page data", () => {
  it("includes only the sections the role may see and never credentials", async () => {
    const { agencyA, adminA } = await world();
    const client = await makeClient("A", "acme", agencyA.id);
    const tenant = { agencyId: agencyA.id, clientId: client.id };
    await prisma().project.create({ data: { ...tenant, name: "P", slug: "p" } });
    await prisma().task.create({
      data: { ...tenant, title: "Late", dueAt: new Date(Date.now() - 1000) },
    });
    await prisma().report.create({
      data: {
        ...tenant,
        title: "R",
        periodStart: new Date("2026-01-01"),
        periodEnd: new Date("2026-01-15"),
      },
    });
    const integration = await prisma().integration.create({
      data: { key: "google_search_console", name: "GSC", category: "search", authType: "oauth2" },
    });
    const account = await prisma().integrationAccount.create({
      data: {
        ...tenant,
        integrationId: integration.id,
        externalAccountId: "x",
        scopes: [],
        status: "needs_reauth",
        encryptedCredentials: createTokenCipherForTests().encrypt("t", "c"),
      },
    });
    await prisma().syncRun.create({
      data: { ...tenant, integrationAccountId: account.id, status: "failed" },
    });

    const full = await getClientSummary(adminA, client.id);
    expect(full.tasks).toEqual({ open: 1, dueSoon: 0, overdue: 1 });
    expect(full.reports).toHaveLength(1);
    expect(full.integrations[0]).toMatchObject({
      status: "needs_reauth",
      latestSync: { status: "failed" },
    });
    expect(JSON.stringify(full)).not.toMatch(/encrypted|v1\./);

    const writer = await makeUser();
    await addMember(writer, client.id, "content_writer");
    const limited = await getClientSummary(writer, client.id);
    expect(limited.reports).toBeNull(); // content_writer has no report.view
    expect(limited.tasks).not.toBeNull();
  });

  it("hides other projects from Client users and other tenants entirely", async () => {
    const { agencyA, adminB } = await world();
    const client = await makeClient("A", "acme", agencyA.id);
    const tenant = { agencyId: agencyA.id, clientId: client.id };
    const mine = await prisma().project.create({ data: { ...tenant, name: "Mine", slug: "mine" } });
    await prisma().project.create({ data: { ...tenant, name: "Not mine", slug: "other" } });
    const clientUser = await makeUser();
    await addMember(clientUser, client.id, "client");
    await prisma().projectMembership.create({
      data: { ...tenant, projectId: mine.id, userId: clientUser.userId },
    });
    const summary = await getClientSummary(clientUser, client.id);
    expect(summary.projects.map((p) => p.name)).toEqual(["Mine"]);
    expect(summary.tasks).toBeNull();
    await expect(getClientSummary(adminB, client.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getClient(adminB, client.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("brand guidelines", () => {
  it("creates a new active version on every save and keeps the history", async () => {
    const { agencyA, adminA } = await world();
    const client = await makeClient("A", "acme", agencyA.id);
    await saveBrandGuideline(adminA, client.id, {
      toneOfVoice: "Warm",
      dos: "Be clear\nBe kind",
      bannedTerms: "cheap, Cheap, free",
    });
    const v2 = await saveBrandGuideline(adminA, client.id, {
      toneOfVoice: "Formal",
      bannedTerms: ["cheap"],
    });
    expect(v2.version).toBe(2);
    const data = await getBrandGuidelines(adminA, client.id);
    expect(data.active?.version).toBe(2);
    expect(data.history.map((h) => [h.version, h.isActive])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(data.history[1]?.bannedTerms).toEqual(["cheap", "free"]);
    expect(
      await prisma().brandGuideline.count({ where: { clientId: client.id, isActive: true } }),
    ).toBe(1);
    expect(
      (await prisma().auditLog.findMany({ where: { action: "brand_guideline.saved" } })).length,
    ).toBe(2);
  });

  it("validates, and respects read vs write permission and tenant boundaries", async () => {
    const { agencyA, adminB } = await world();
    const client = await makeClient("A", "acme", agencyA.id);
    const reviewer = await makeUser();
    await addMember(reviewer, client.id, "reviewer");
    const manager = await makeUser();
    await addMember(manager, client.id, "seo_manager");
    expect(
      (
        await fieldErrors(
          saveBrandGuideline(manager, client.id, {
            toneOfVoice: "x".repeat(1001),
            bannedTerms: Array.from({ length: 51 }, (_, i) => `term${i}`),
          }),
        )
      ).toneOfVoice,
    ).toBeDefined();
    await saveBrandGuideline(manager, client.id, { toneOfVoice: "Warm" });
    expect((await getBrandGuidelines(reviewer, client.id)).canEdit).toBe(false);
    await expect(
      saveBrandGuideline(reviewer, client.id, { toneOfVoice: "Nope" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getBrandGuidelines(adminB, client.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      saveBrandGuideline(adminB, client.id, { toneOfVoice: "Nope" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
