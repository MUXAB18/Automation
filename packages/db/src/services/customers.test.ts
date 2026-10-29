import { beforeEach, describe, expect, it } from "vitest";
import { forCustomer } from "../access";
import { ConflictError, ForbiddenError, NotFoundError, ScopeViolationError, ValidationError } from "../errors";
import { addMember, makeCustomer, makeUser, prisma, resetDb } from "../../test/helpers";
import {
  addWebsite,
  createCustomer,
  getCustomer,
  getOverviewStats,
  listCustomers,
  removeWebsite,
  setCustomerStatus,
  updateCustomer,
} from "./customers";

beforeEach(resetDb);

describe("customer visibility", () => {
  it("lets a member see only customers they belong to", async () => {
    const member = await makeUser();
    const mine = await makeCustomer("Mine");
    const other = await makeCustomer("Other");
    await addMember(member, mine.id, "member");

    const visible = await listCustomers(member);
    expect(visible.map((c) => c.id)).toEqual([mine.id]);
    await expect(getCustomer(member, other.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateCustomer(member, other.id, { name: "x", slug: "xx" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(addWebsite(member, other.id, { domain: "x.com" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("shows a user with no memberships nothing", async () => {
    const loner = await makeUser();
    await makeCustomer("Someone");
    expect(await listCustomers(loner)).toEqual([]);
    expect((await getOverviewStats(loner)).total).toBe(0);
  });

  it("lets admins see everything", async () => {
    const admin = await makeUser(true);
    await makeCustomer("A");
    await makeCustomer("B");
    expect(await listCustomers(admin)).toHaveLength(2);
  });

  it("scopes the list to the switcher selection and refuses foreign ids", async () => {
    const member = await makeUser();
    const mine = await makeCustomer("Mine");
    const other = await makeCustomer("Other");
    await addMember(member, mine.id, "member");
    expect(await listCustomers(member, { customerId: mine.id })).toHaveLength(1);
    await expect(listCustomers(member, { customerId: other.id })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("searches by name and domain", async () => {
    const admin = await makeUser(true);
    await createCustomer(admin, { name: "Alpha", primaryDomain: "alpha.io" });
    await createCustomer(admin, { name: "Beta", primaryDomain: "beta.io" });
    expect((await listCustomers(admin, { search: "alp" })).map((c) => c.name)).toEqual(["Alpha"]);
    expect((await listCustomers(admin, { search: "beta.io" })).map((c) => c.name)).toEqual(["Beta"]);
  });
});

describe("tenant isolation in scoped clients", () => {
  it("cannot read or write another customer's rows", async () => {
    const a = await makeCustomer("A");
    const b = await makeCustomer("B");
    await prisma().website.create({ data: { customerId: b.id, domain: "b.com", isPrimary: true } });

    const db = forCustomer(a.id);
    expect(await db.website.findMany()).toEqual([]);
    expect(await db.website.updateMany({ where: {}, data: { status: "inactive" } })).toEqual({ count: 0 });
    expect(await db.website.deleteMany()).toEqual({ count: 0 });
    await expect(db.website.create({ data: { customerId: b.id, domain: "evil.com" } })).rejects.toBeInstanceOf(
      ScopeViolationError,
    );
    expect(await prisma().website.count({ where: { customerId: b.id } })).toBe(1);
  });

  it("applies the scope inside transactions", async () => {
    const a = await makeCustomer("A");
    const b = await makeCustomer("B");
    await prisma().website.create({ data: { customerId: b.id, domain: "b.com" } });
    const seen = await forCustomer(a.id).$transaction((tx) => tx.website.findMany());
    expect(seen).toEqual([]);
  });
});

describe("createCustomer", () => {
  it("creates the customer, primary website and an audit entry", async () => {
    const admin = await makeUser(true);
    const customer = await createCustomer(admin, {
      name: "SARJ Test",
      reportEmail: "reports@example.com",
      primaryDomain: "https://sarj.example.com",
    });
    expect(customer.slug).toBe("sarj-test");
    expect(customer.status).toBe("active");
    expect(customer.reportIntervalDays).toBe(15);

    const websites = await prisma().website.findMany({ where: { customerId: customer.id } });
    expect(websites).toMatchObject([{ domain: "sarj.example.com", isPrimary: true }]);

    const log = await prisma().auditLog.findMany({ where: { customerId: customer.id } });
    expect(log).toMatchObject([{ action: "customer.created", actorUserId: admin.userId }]);
  });

  it("is admin only", async () => {
    const member = await makeUser();
    await expect(createCustomer(member, { name: "Nope" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("validates input", async () => {
    const admin = await makeUser(true);
    await expect(createCustomer(admin, { name: "" })).rejects.toBeInstanceOf(ValidationError);
    expect(await prisma().customer.count()).toBe(0);
  });

  it("suffixes auto slugs on collision but rejects explicit duplicates", async () => {
    const admin = await makeUser(true);
    const first = await createCustomer(admin, { name: "Acme" });
    const second = await createCustomer(admin, { name: "Acme" });
    expect([first.slug, second.slug]).toEqual(["acme", "acme-2"]);
    await expect(createCustomer(admin, { name: "Other", slug: "acme" })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("updateCustomer", () => {
  it("updates fields and logs before/after", async () => {
    const admin = await makeUser(true);
    const c = await createCustomer(admin, { name: "Old Name" });
    const updated = await updateCustomer(admin, c.id, {
      name: "New Name",
      slug: "new-name",
      reportEmail: "r@example.com",
      reportIntervalDays: 30,
    });
    expect(updated).toMatchObject({ name: "New Name", slug: "new-name", reportIntervalDays: 30 });

    const log = await prisma().auditLog.findFirstOrThrow({ where: { action: "customer.updated" } });
    expect(log.before).toMatchObject({ name: "Old Name", reportIntervalDays: 15 });
    expect(log.after).toMatchObject({ name: "New Name", reportIntervalDays: 30 });
  });

  it("lets members edit but not viewers", async () => {
    const admin = await makeUser(true);
    const member = await makeUser();
    const viewer = await makeUser();
    const c = await createCustomer(admin, { name: "Acme" });
    await addMember(member, c.id, "member");
    await addMember(viewer, c.id, "viewer");
    const input = { name: "Acme 2", slug: "acme" };
    await expect(updateCustomer(viewer, c.id, input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateCustomer(member, c.id, input)).resolves.toMatchObject({ name: "Acme 2" });
  });

  it("rejects a slug that belongs to another customer", async () => {
    const admin = await makeUser(true);
    await createCustomer(admin, { name: "One" });
    const two = await createCustomer(admin, { name: "Two" });
    await expect(updateCustomer(admin, two.id, { name: "Two", slug: "one" })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("setCustomerStatus", () => {
  it("pauses, archives and logs each change", async () => {
    const admin = await makeUser(true);
    const c = await createCustomer(admin, { name: "Acme" });
    expect((await setCustomerStatus(admin, c.id, "paused")).status).toBe("paused");
    expect((await setCustomerStatus(admin, c.id, "archived")).status).toBe("archived");
    const log = await prisma().auditLog.findMany({ where: { action: "customer.status_changed" }, orderBy: { createdAt: "asc" } });
    expect(log.map((l) => l.after)).toEqual([{ status: "paused" }, { status: "archived" }]);
    expect(await getOverviewStats(admin)).toEqual({ total: 1, active: 0, paused: 0, archived: 1 });
  });

  it("does not log a no-op", async () => {
    const admin = await makeUser(true);
    const c = await createCustomer(admin, { name: "Acme" });
    await setCustomerStatus(admin, c.id, "active");
    expect(await prisma().auditLog.count({ where: { action: "customer.status_changed" } })).toBe(0);
  });

  it("is limited to admins of the customer", async () => {
    const admin = await makeUser(true);
    const member = await makeUser();
    const c = await createCustomer(admin, { name: "Acme" });
    await addMember(member, c.id, "member");
    await expect(setCustomerStatus(member, c.id, "paused")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("websites", () => {
  it("makes the first website primary and moves primary on request", async () => {
    const admin = await makeUser(true);
    const c = await createCustomer(admin, { name: "Acme" });
    const first = await addWebsite(admin, c.id, { domain: "a.com" });
    const second = await addWebsite(admin, c.id, { domain: "https://b.com", isPrimary: true });
    expect(first.isPrimary).toBe(true);
    expect(second.domain).toBe("b.com");
    const all = await prisma().website.findMany({ where: { customerId: c.id } });
    expect(all.filter((w) => w.isPrimary).map((w) => w.domain)).toEqual(["b.com"]);
  });

  it("promotes another site when the primary is removed, and logs it", async () => {
    const admin = await makeUser(true);
    const c = await createCustomer(admin, { name: "Acme", primaryDomain: "a.com" });
    await addWebsite(admin, c.id, { domain: "b.com" });
    const a = await prisma().website.findFirstOrThrow({ where: { domain: "a.com" } });
    await removeWebsite(admin, c.id, a.id);
    const left = await prisma().website.findMany({ where: { customerId: c.id } });
    expect(left).toMatchObject([{ domain: "b.com", isPrimary: true }]);
    expect(await prisma().auditLog.count({ where: { action: "website.removed" } })).toBe(1);
  });

  it("rejects duplicates and cross-customer removal", async () => {
    const admin = await makeUser(true);
    const one = await createCustomer(admin, { name: "One", primaryDomain: "a.com" });
    const two = await createCustomer(admin, { name: "Two" });
    await expect(addWebsite(admin, one.id, { domain: "A.com" })).rejects.toBeInstanceOf(ConflictError);
    const site = await prisma().website.findFirstOrThrow({ where: { customerId: one.id } });
    await expect(removeWebsite(admin, two.id, site.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("blocks viewers", async () => {
    const admin = await makeUser(true);
    const viewer = await makeUser();
    const c = await createCustomer(admin, { name: "Acme" });
    await addMember(viewer, c.id, "viewer");
    await expect(addWebsite(viewer, c.id, { domain: "x.com" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
