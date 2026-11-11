import { beforeEach, describe, expect, it } from "vitest";
import { createTokenCipherForTests } from "../../test/cipher";
import { addMember, makeAgency, makeClient, makeUser, prisma, resetDb } from "../../test/helpers";
import { NotFoundError } from "../errors";
import { connectAccount, updateAccountCredentials, withAccountCredentials } from "./integrations";
import { getProviderDataSummary, persistProviderRecords } from "./provider-data";

beforeEach(resetDb);
const cipher = createTokenCipherForTests();

async function world() {
  const agency = await makeAgency("Agency");
  const other = await makeAgency("Other");
  const a = await makeClient("A", "a", agency.id);
  const b = await makeClient("B", "b", other.id);
  await prisma().integration.create({
    data: { key: "gohighlevel", name: "GoHighLevel", category: "crm", authType: "oauth2" },
  });
  const manager = await makeUser();
  await addMember(manager, a.id, "seo_manager");
  const outsider = await makeUser();
  await addMember(outsider, b.id, "seo_manager");
  const connect = (clientId: string, user = manager) =>
    connectAccount(
      user,
      {
        clientId,
        integrationKey: "gohighlevel",
        externalAccountId: "loc1",
        credentials: { accessToken: "tok" },
        scopes: ["contacts.readonly"],
      },
      cipher,
    );
  const accountA = await connect(a.id);
  const accountB = await connect(b.id, outsider);
  const target = (clientId: string, accountId: string, agencyId: string, syncRunId = "run") => ({
    agencyId,
    clientId,
    accountId,
    syncRunId,
  });
  return { agency, other, a, b, manager, outsider, accountA, accountB, target };
}

const contact = (id: string, over: Record<string, unknown> = {}) => ({
  resource: "contacts",
  externalId: id,
  data: {
    name: "Ann",
    email: "ann@x.test",
    tags: ["vip"],
    externalCreatedAt: "2025-01-01T00:00:00.000Z",
    ...over,
  },
});

describe("persisting synced records", () => {
  it("updates instead of duplicating when the same provider record arrives again", async () => {
    const { a, accountA, target } = await world();
    const t = target(a.id, accountA.id, a.agencyId);
    expect(await persistProviderRecords(t, "contacts", [contact("c1"), contact("c2")])).toBe(2);
    expect(await persistProviderRecords(t, "contacts", [contact("c1", { name: "Ann Lee" })])).toBe(
      1,
    );
    const rows = await prisma().crmContact.findMany({ orderBy: { externalId: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      externalId: "c1",
      name: "Ann Lee",
      clientId: a.id,
      integrationAccountId: accountA.id,
    });
    expect(rows[0]!.externalCreatedAt?.toISOString()).toBe("2025-01-01T00:00:00.000Z");
  });

  it("keeps the same provider id apart per account and per client", async () => {
    const { a, b, accountA, accountB, target } = await world();
    await persistProviderRecords(target(a.id, accountA.id, a.agencyId), "contacts", [
      contact("same"),
    ]);
    await persistProviderRecords(target(b.id, accountB.id, b.agencyId), "contacts", [
      contact("same"),
    ]);
    expect(await prisma().crmContact.count()).toBe(2);
  });

  it("cannot attach rows to another client's account (composite foreign keys)", async () => {
    const { a, b, accountB } = await world();
    await expect(
      prisma().crmContact.create({
        data: {
          agencyId: a.agencyId,
          clientId: a.id,
          integrationAccountId: accountB.id,
          externalId: "x",
          tags: [],
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma().crmContact.create({
        data: {
          agencyId: b.agencyId,
          clientId: a.id,
          integrationAccountId: accountB.id,
          externalId: "x",
          tags: [],
        },
      }),
    ).rejects.toThrow();
  });

  it("stores campaigns and workflows separately even with the same provider id", async () => {
    const { a, accountA, target } = await world();
    const t = target(a.id, accountA.id, a.agencyId);
    await persistProviderRecords(t, "campaigns", [
      {
        resource: "campaigns",
        externalId: "1",
        data: { kind: "campaign", name: "C", status: "active" },
      },
    ]);
    await persistProviderRecords(t, "workflows", [
      {
        resource: "workflows",
        externalId: "1",
        data: { kind: "workflow", name: "W", status: "published", version: 3 },
      },
    ]);
    expect(await prisma().crmAutomation.count()).toBe(2);
  });

  it("writes nothing when a batch contains invalid data, and rejects unknown resources", async () => {
    const { a, accountA, target } = await world();
    const t = target(a.id, accountA.id, a.agencyId);
    await expect(
      persistProviderRecords(t, "contacts", [
        contact("ok"),
        contact("bad", { tags: "not-a-list" }),
      ]),
    ).rejects.toThrow();
    expect(await prisma().crmContact.count()).toBe(0);
    await expect(
      persistProviderRecords(t, "bogus", [{ resource: "bogus", externalId: "1", data: {} }]),
    ).rejects.toThrow(/No storage/);
  });

  it("stores one append-only statistics reading per sync run", async () => {
    const { a, accountA, target } = await world();
    const run = await prisma().syncRun.create({
      data: {
        agencyId: a.agencyId,
        clientId: a.id,
        integrationAccountId: accountA.id,
        status: "succeeded",
      },
    });
    const t = target(a.id, accountA.id, a.agencyId, run.id);
    const stat = {
      resource: "social_statistics",
      externalId: "7d",
      data: { windowDays: 7, posts: 3, likes: 9, followers: 100, impressions: 5000, comments: 2 },
    };
    await persistProviderRecords(t, "social_statistics", [stat]);
    await persistProviderRecords(t, "social_statistics", [stat]);
    expect(await prisma().providerSocialStat.count()).toBe(1);
    await expect(prisma().providerSocialStat.updateMany({ data: { likes: 1 } })).rejects.toThrow(
      /append-only/,
    );
  });

  it("audits each stored batch", async () => {
    const { a, accountA, target } = await world();
    await persistProviderRecords(target(a.id, accountA.id, a.agencyId), "contacts", [
      contact("c1"),
    ]);
    expect(
      await prisma().auditLog.count({
        where: { action: "integration.records_synced", clientId: a.id },
      }),
    ).toBe(1);
  });
});

describe("summary read model", () => {
  it("returns counts and social destinations only to people who may view, and no contact details", async () => {
    const { a, accountA, manager, outsider, target } = await world();
    const t = target(a.id, accountA.id, a.agencyId);
    await persistProviderRecords(t, "contacts", [contact("c1")]);
    await persistProviderRecords(t, "opportunities", [
      {
        resource: "opportunities",
        externalId: "o1",
        data: { name: "Deal", status: "open", monetaryValue: 10 },
      },
    ]);
    await persistProviderRecords(t, "social_accounts", [
      {
        resource: "social_accounts",
        externalId: "s1",
        data: { platform: "facebook", name: "Page" },
      },
    ]);
    const summary = await getProviderDataSummary(manager, accountA.id);
    expect(summary.counts).toMatchObject({ contacts: 1, opportunities: 1, openOpportunities: 1 });
    expect(summary.socialAccounts).toEqual([
      expect.objectContaining({ externalId: "s1", platform: "facebook" }),
    ]);
    expect(JSON.stringify(summary)).not.toContain("ann@x.test");
    await expect(getProviderDataSummary(outsider, accountA.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("credential refresh storage", () => {
  it("replaces the stored credentials (encrypted) and audits it without secrets", async () => {
    const { manager, accountA } = await world();
    await updateAccountCredentials(
      accountA.id,
      { accessToken: "new-token", refreshToken: "rot-2" },
      cipher,
      { tokenExpiresAt: new Date("2030-01-01") },
    );
    const row = await prisma().integrationAccount.findUniqueOrThrow({ where: { id: accountA.id } });
    expect(row.encryptedCredentials).not.toContain("rot-2");
    expect(row.tokenExpiresAt?.getUTCFullYear()).toBe(2030);
    await withAccountCredentials(manager, accountA.id, "integration.sync", cipher, async (c) =>
      expect(c.refreshToken).toBe("rot-2"),
    );
    expect(
      JSON.stringify(
        await prisma().auditLog.findMany({
          where: { action: "integration.credentials_refreshed" },
        }),
      ),
    ).not.toContain("rot-2");
  });
});
