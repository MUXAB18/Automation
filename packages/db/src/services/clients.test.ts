import { beforeEach, describe, expect, it } from "vitest";
import { forClient } from "../access";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ScopeViolationError,
  ValidationError,
} from "../errors";
import {
  addAgencyStaff,
  addMember,
  getDefaultAgencyId,
  makeAgency,
  makeClient,
  makeUser,
  prisma,
  resetDb,
} from "../../test/helpers";
import {
  addWebsite,
  createClient,
  getClient,
  getOverviewStats,
  listClients,
  removeWebsite,
  setClientStatus,
  updateClient,
} from "./clients";

beforeEach(async () => {
  await resetDb();
  await getDefaultAgencyId();
});

describe("client visibility", () => {
  it("lets a member see only clients they belong to", async () => {
    const member = await makeUser();
    const mine = await makeClient("Mine");
    const other = await makeClient("Other");
    await addMember(member, mine.id, "member");

    const visible = await listClients(member);
    expect(visible.map((c) => c.id)).toEqual([mine.id]);
    await expect(getClient(member, other.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateClient(member, other.id, { name: "x", slug: "xx" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(addWebsite(member, other.id, { domain: "x.com" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("shows a user with no memberships nothing", async () => {
    const loner = await makeUser();
    await makeClient("Someone");
    expect(await listClients(loner)).toEqual([]);
    expect((await getOverviewStats(loner)).total).toBe(0);
  });

  it("lets admins see everything", async () => {
    const admin = await makeUser(true);
    await makeClient("A");
    await makeClient("B");
    expect(await listClients(admin)).toHaveLength(2);
  });

  it("scopes the list to the switcher selection and refuses foreign ids", async () => {
    const member = await makeUser();
    const mine = await makeClient("Mine");
    const other = await makeClient("Other");
    await addMember(member, mine.id, "member");
    expect(await listClients(member, { clientId: mine.id })).toHaveLength(1);
    await expect(listClients(member, { clientId: other.id })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("searches by name and domain", async () => {
    const admin = await makeUser(true);
    await createClient(admin, { name: "Alpha", primaryDomain: "alpha.io" });
    await createClient(admin, { name: "Beta", primaryDomain: "beta.io" });
    expect((await listClients(admin, { search: "alp" })).map((c) => c.name)).toEqual(["Alpha"]);
    expect((await listClients(admin, { search: "beta.io" })).map((c) => c.name)).toEqual(["Beta"]);
  });
});

describe("tenant isolation in scoped clients", () => {
  it("cannot read or write another client's rows", async () => {
    const a = await makeClient("A");
    const b = await makeClient("B");
    await prisma().website.create({
      data: { agencyId: b.agencyId, clientId: b.id, domain: "b.com", isPrimary: true },
    });

    const db = forClient(a.id);
    expect(await db.website.findMany()).toEqual([]);
    expect(await db.website.updateMany({ where: {}, data: { status: "inactive" } })).toEqual({
      count: 0,
    });
    expect(await db.website.deleteMany()).toEqual({ count: 0 });
    await expect(
      db.website.create({ data: { agencyId: b.agencyId, clientId: b.id, domain: "evil.com" } }),
    ).rejects.toBeInstanceOf(ScopeViolationError);
    expect(await prisma().website.count({ where: { clientId: b.id } })).toBe(1);
  });

  it("applies the scope inside transactions", async () => {
    const a = await makeClient("A");
    const b = await makeClient("B");
    await prisma().website.create({
      data: { agencyId: b.agencyId, clientId: b.id, domain: "b.com" },
    });
    const seen = await forClient(a.id).$transaction((tx) => tx.website.findMany());
    expect(seen).toEqual([]);
  });
});

describe("createClient", () => {
  it("creates the client, primary website and an audit entry", async () => {
    const admin = await makeUser(true);
    const client = await createClient(admin, {
      name: "SARJ Test",
      reportEmail: "reports@example.com",
      primaryDomain: "https://sarj.example.com",
    });
    expect(client.slug).toBe("sarj-test");
    expect(client.status).toBe("active");
    expect(client.reportIntervalDays).toBe(15);

    const websites = await prisma().website.findMany({ where: { clientId: client.id } });
    expect(websites).toMatchObject([{ domain: "sarj.example.com", isPrimary: true }]);

    const log = await prisma().auditLog.findMany({ where: { clientId: client.id } });
    expect(log).toMatchObject([{ action: "client.created", actorUserId: admin.userId }]);
  });

  it("is admin only", async () => {
    const member = await makeUser();
    await expect(createClient(member, { name: "Nope" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("validates input", async () => {
    const admin = await makeUser(true);
    await expect(createClient(admin, { name: "" })).rejects.toBeInstanceOf(ValidationError);
    expect(await prisma().client.count()).toBe(0);
  });

  it("suffixes auto slugs on collision but rejects explicit duplicates", async () => {
    const admin = await makeUser(true);
    const first = await createClient(admin, { name: "Acme" });
    const second = await createClient(admin, { name: "Acme" });
    expect([first.slug, second.slug]).toEqual(["acme", "acme-2"]);
    await expect(createClient(admin, { name: "Other", slug: "acme" })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe("updateClient", () => {
  it("updates fields and logs before/after", async () => {
    const admin = await makeUser(true);
    const c = await createClient(admin, { name: "Old Name" });
    const updated = await updateClient(admin, c.id, {
      name: "New Name",
      slug: "new-name",
      reportEmail: "r@example.com",
      reportIntervalDays: 30,
    });
    expect(updated).toMatchObject({ name: "New Name", slug: "new-name", reportIntervalDays: 30 });

    const log = await prisma().auditLog.findFirstOrThrow({ where: { action: "client.updated" } });
    expect(log.before).toMatchObject({ name: "Old Name", reportIntervalDays: 15 });
    expect(log.after).toMatchObject({ name: "New Name", reportIntervalDays: 30 });
  });

  it("lets members edit but not viewers", async () => {
    const admin = await makeUser(true);
    const member = await makeUser();
    const viewer = await makeUser();
    const c = await createClient(admin, { name: "Acme" });
    await addMember(member, c.id, "member");
    await addMember(viewer, c.id, "viewer");
    const input = { name: "Acme 2", slug: "acme" };
    await expect(updateClient(viewer, c.id, input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateClient(member, c.id, input)).resolves.toMatchObject({ name: "Acme 2" });
  });

  it("rejects a slug that belongs to another client", async () => {
    const admin = await makeUser(true);
    await createClient(admin, { name: "One" });
    const two = await createClient(admin, { name: "Two" });
    await expect(updateClient(admin, two.id, { name: "Two", slug: "one" })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe("setClientStatus", () => {
  it("pauses, archives and logs each change", async () => {
    const admin = await makeUser(true);
    const c = await createClient(admin, { name: "Acme" });
    expect((await setClientStatus(admin, c.id, "paused")).status).toBe("paused");
    expect((await setClientStatus(admin, c.id, "archived")).status).toBe("archived");
    const log = await prisma().auditLog.findMany({
      where: { action: "client.status_changed" },
      orderBy: { createdAt: "asc" },
    });
    expect(log.map((l) => l.after)).toEqual([{ status: "paused" }, { status: "archived" }]);
    expect(await getOverviewStats(admin)).toEqual({ total: 1, active: 0, paused: 0, archived: 1 });
  });

  it("does not log a no-op", async () => {
    const admin = await makeUser(true);
    const c = await createClient(admin, { name: "Acme" });
    await setClientStatus(admin, c.id, "active");
    expect(await prisma().auditLog.count({ where: { action: "client.status_changed" } })).toBe(0);
  });

  it("is limited to admins of the client", async () => {
    const admin = await makeUser(true);
    const member = await makeUser();
    const c = await createClient(admin, { name: "Acme" });
    await addMember(member, c.id, "member");
    await expect(setClientStatus(member, c.id, "paused")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("websites", () => {
  it("makes the first website primary and moves primary on request", async () => {
    const admin = await makeUser(true);
    const c = await createClient(admin, { name: "Acme" });
    const first = await addWebsite(admin, c.id, { domain: "a.com" });
    const second = await addWebsite(admin, c.id, { domain: "https://b.com", isPrimary: true });
    expect(first.isPrimary).toBe(true);
    expect(second.domain).toBe("b.com");
    const all = await prisma().website.findMany({ where: { clientId: c.id } });
    expect(all.filter((w) => w.isPrimary).map((w) => w.domain)).toEqual(["b.com"]);
  });

  it("promotes another site when the primary is removed, and logs it", async () => {
    const admin = await makeUser(true);
    const c = await createClient(admin, { name: "Acme", primaryDomain: "a.com" });
    await addWebsite(admin, c.id, { domain: "b.com" });
    const a = await prisma().website.findFirstOrThrow({ where: { domain: "a.com" } });
    await removeWebsite(admin, c.id, a.id);
    const left = await prisma().website.findMany({ where: { clientId: c.id } });
    expect(left).toMatchObject([{ domain: "b.com", isPrimary: true }]);
    expect(await prisma().auditLog.count({ where: { action: "website.removed" } })).toBe(1);
  });

  it("rejects duplicates and cross-client removal", async () => {
    const admin = await makeUser(true);
    const one = await createClient(admin, { name: "One", primaryDomain: "a.com" });
    const two = await createClient(admin, { name: "Two" });
    await expect(addWebsite(admin, one.id, { domain: "A.com" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    const site = await prisma().website.findFirstOrThrow({ where: { clientId: one.id } });
    await expect(removeWebsite(admin, two.id, site.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("blocks viewers", async () => {
    const admin = await makeUser(true);
    const viewer = await makeUser();
    const c = await createClient(admin, { name: "Acme" });
    await addMember(viewer, c.id, "viewer");
    await expect(addWebsite(viewer, c.id, { domain: "x.com" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("agencies", () => {
  it("creates clients in the only agency, and asks which one when there are several", async () => {
    const admin = await makeUser(true);
    const created = await createClient(admin, { name: "One" });
    expect((await prisma().client.findUniqueOrThrow({ where: { id: created.id } })).agencyId).toBe(
      await getDefaultAgencyId(),
    );

    const second = await makeAgency("Second");
    await expect(createClient(admin, { name: "Two" })).rejects.toBeInstanceOf(ValidationError);
    const inSecond = await createClient(admin, { name: "Two", agencyId: second.id });
    expect(inSecond.agencyId).toBe(second.id);
  });

  it("lets the same slug exist in different agencies", async () => {
    const other = await makeAgency("Other");
    await makeClient("Same", "same");
    await expect(makeClient("Same", "same", other.id)).resolves.toBeTruthy();
    await expect(makeClient("Same", "same")).rejects.toThrow();
  });

  it("gives agency staff with all-clients access every client of their agency, and nothing elsewhere", async () => {
    const staff = await makeUser();
    const other = await makeAgency("Other");
    const mine = await makeClient("Mine");
    const theirs = await makeClient("Theirs", "theirs", other.id);
    await addAgencyStaff(staff, await getDefaultAgencyId(), "admin", true);

    expect((await listClients(staff)).map((c) => c.id)).toEqual([mine.id]);
    await expect(getClient(staff, theirs.id)).rejects.toBeInstanceOf(NotFoundError);
    // Agency admin holds the admin permissions on the agency's clients.
    await expect(setClientStatus(staff, mine.id, "paused")).resolves.toBeTruthy();
  });

  it("does not let agency staff without all-clients access see unassigned clients", async () => {
    const staff = await makeUser();
    const client = await makeClient("Mine");
    await addAgencyStaff(staff, await getDefaultAgencyId(), "admin", false);
    expect(await listClients(staff)).toEqual([]);
    await expect(getClient(staff, client.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("ignores suspended memberships", async () => {
    const member = await makeUser();
    const client = await makeClient("Mine");
    const membership = await addMember(member, client.id, "admin");
    await prisma().clientMembership.update({
      where: { id: membership.id },
      data: { status: "suspended" },
    });
    await expect(getClient(member, client.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
