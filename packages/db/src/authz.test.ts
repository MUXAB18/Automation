import { beforeEach, describe, expect, it } from "vitest";
import {
  getClientContext,
  listAgenciesWith,
  requireAgencyPermission,
  requirePermission,
} from "./access";
import { authorize } from "./authorize";
import { ForbiddenError, NotFoundError } from "./errors";
import { can } from "./permissions";
import {
  addAgencyStaff,
  addMember,
  makeAgency,
  makeClient,
  makeUser,
  prisma,
  resetDb,
} from "../test/helpers";

beforeEach(resetDb);

async function world() {
  const agencyA = await makeAgency("Agency A");
  const agencyB = await makeAgency("Agency B");
  const a = await makeClient("Client A", "client-a", agencyA.id);
  const a2 = await makeClient("Client A2", "client-a2", agencyA.id);
  const b = await makeClient("Client B", "client-b", agencyB.id);
  const projectA = await prisma().project.create({
    data: { agencyId: agencyA.id, clientId: a.id, name: "PA", slug: "pa" },
  });
  const projectB = await prisma().project.create({
    data: { agencyId: agencyB.id, clientId: b.id, name: "PB", slug: "pb" },
  });
  return { agencyA, agencyB, a, a2, b, projectA, projectB };
}

const auditActions = async (action: string) => prisma().auditLog.findMany({ where: { action } });

describe("client access resolution", () => {
  it("gives a user the union of every role they hold on a client", async () => {
    const { a } = await world();
    const user = await makeUser();
    await addMember(user, a.id, ["seo_specialist", "content_writer"]);
    const ctx = await getClientContext(user, a.id);
    expect([...ctx.access.roles].sort()).toEqual(["content_writer", "seo_specialist"]);
    expect(can(ctx.access, "seo.manage")).toBe(true);
    expect(can(ctx.access, "content.create")).toBe(true);
    expect(can(ctx.access, "content.approve")).toBe(false);
  });

  it("applies per-client roles only to that client", async () => {
    const { a, a2 } = await world();
    const user = await makeUser();
    await addMember(user, a.id, "seo_manager");
    await expect(requirePermission(user, a.id, "client.update")).resolves.toBeTruthy();
    await expect(requirePermission(user, a2.id, "client.view")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("applies agency-wide roles to every client of that agency only when all-clients access is on", async () => {
    const { agencyA, a, a2, b } = await world();
    const wide = await makeUser();
    const narrow = await makeUser();
    await addAgencyStaff(wide, agencyA.id, "reviewer", true);
    await addAgencyStaff(narrow, agencyA.id, "agency_admin", false);
    for (const id of [a.id, a2.id])
      await expect(requirePermission(wide, id, "client.view")).resolves.toBeTruthy();
    await expect(requirePermission(wide, b.id, "client.view")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(requirePermission(narrow, a.id, "client.view")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("combines agency-wide and per-client roles", async () => {
    const { agencyA, a } = await world();
    const user = await makeUser();
    await addAgencyStaff(user, agencyA.id, "reviewer", true);
    await addMember(user, a.id, "seo_specialist");
    const { access } = await getClientContext(user, a.id);
    expect(can(access, "content.approve")).toBe(true); // from the agency-wide Reviewer role
    expect(can(access, "seo.manage")).toBe(true); // from the per-client SEO Specialist role
  });

  it("never lets a per-client role grant agency-level permissions", async () => {
    const { a, agencyA } = await world();
    const user = await makeUser();
    await addMember(user, a.id, "agency_admin"); // an Agency Admin role used at client level
    const { access } = await getClientContext(user, a.id);
    expect(can(access, "client.status")).toBe(true);
    expect(can(access, "agency.members")).toBe(false);
    expect(can(access, "client.create")).toBe(false);
    // A client-level seat gives no agency-level standing at all.
    await expect(
      requireAgencyPermission(user, agencyA.id, "agency.members"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("stops applying when the agency seat is suspended or the user is deactivated", async () => {
    const { agencyA, a } = await world();
    const user = await makeUser();
    await addMember(user, a.id, "seo_manager");
    await prisma().agencyMembership.updateMany({
      where: { agencyId: agencyA.id, userId: user.userId },
      data: { status: "suspended" },
    });
    await expect(getClientContext(user, a.id)).rejects.toBeInstanceOf(NotFoundError);

    await prisma().agencyMembership.updateMany({
      where: { agencyId: agencyA.id, userId: user.userId },
      data: { status: "active" },
    });
    await expect(getClientContext(user, a.id)).resolves.toBeTruthy();
    await prisma().user.update({ where: { id: user.userId }, data: { deactivatedAt: new Date() } });
    await expect(getClientContext(user, a.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("gives platform admins everything", async () => {
    const { a, agencyB } = await world();
    const admin = await makeUser(true);
    expect((await getClientContext(admin, a.id)).access.permissions.size).toBeGreaterThan(20);
    await expect(requireAgencyPermission(admin, agencyB.id, "agency.manage")).resolves.toBeTruthy();
  });
});

describe("tenant isolation: guessing or editing ids", () => {
  it("answers 'not found' identically for another tenant's client and a missing one", async () => {
    const { b } = await world();
    const user = await makeUser();
    await addMember(
      user,
      (await prisma().client.findFirstOrThrow({ where: { slug: "client-a" } })).id,
      "seo_manager",
    );
    const other = await getClientContext(user, b.id).catch((e: Error) => e);
    const missing = await getClientContext(user, "00000000-0000-4000-8000-000000000000").catch(
      (e: Error) => e,
    );
    expect(other).toBeInstanceOf(NotFoundError);
    expect(missing).toBeInstanceOf(NotFoundError);
    expect((other as Error).message).toBe((missing as Error).message);
  });

  it("rejects a project id that belongs to a different client than the client id supplied", async () => {
    const { a, projectB } = await world();
    const user = await makeUser();
    await addMember(user, a.id, "agency_admin");
    await expect(
      authorize(user, { clientId: a.id, projectId: projectB.id }, "project.manage"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects a project whose client the user cannot access, even with no client id supplied", async () => {
    const { a, projectB } = await world();
    const user = await makeUser();
    await addMember(user, a.id, "agency_admin");
    await expect(
      authorize(user, { projectId: projectB.id }, "project.manage"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects a client id that belongs to a different agency than the agency id supplied", async () => {
    const { a, agencyB } = await world();
    const user = await makeUser();
    await addMember(user, a.id, "agency_admin");
    await expect(
      authorize(user, { agencyId: agencyB.id, clientId: a.id }, "client.view"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not let an agency admin of one agency act on another agency", async () => {
    const { agencyA, agencyB, b } = await world();
    const admin = await makeUser();
    await addAgencyStaff(admin, agencyA.id, "agency_admin", true);
    await expect(
      requireAgencyPermission(admin, agencyB.id, "agency.members"),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(requirePermission(admin, b.id, "client.view")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("distinguishes 'no access' (not found) from 'no permission' (forbidden)", async () => {
    const { a } = await world();
    const reviewer = await makeUser();
    await addMember(reviewer, a.id, "reviewer");
    await expect(authorize(reviewer, { clientId: a.id }, "client.update")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(authorize(reviewer, { clientId: a.id }, "client.view")).resolves.toMatchObject({
      level: "client",
    });
  });

  it("writes refusals to the audit log without leaking secrets", async () => {
    const { a, b } = await world();
    const user = await makeUser();
    await addMember(user, a.id, "reviewer");
    await getClientContext(user, b.id).catch(() => {});
    await authorize(user, { clientId: a.id }, "client.update").catch(() => {});
    const denied = await auditActions("authz.access_denied");
    const forbidden = await auditActions("authz.permission_denied");
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({
      actorUserId: user.userId,
      clientId: b.id,
      entityType: "client",
    });
    expect(forbidden).toHaveLength(1);
    expect(forbidden[0]?.after).toEqual({ permission: "client.update" });
  });
});

describe("project-scoped client users", () => {
  it("lets a client-role user into a project only if they were added to it", async () => {
    const { a, agencyA, projectA } = await world();
    const clientUser = await makeUser();
    await addMember(clientUser, a.id, "client");
    await expect(
      authorize(clientUser, { projectId: projectA.id }, "client.view"),
    ).rejects.toBeInstanceOf(NotFoundError);

    await prisma().projectMembership.create({
      data: {
        agencyId: agencyA.id,
        clientId: a.id,
        projectId: projectA.id,
        userId: clientUser.userId,
        role: "viewer",
      },
    });
    await expect(
      authorize(clientUser, { projectId: projectA.id }, "client.view"),
    ).resolves.toMatchObject({ projectId: projectA.id });
  });

  it("does not restrict staff to projects they were not added to", async () => {
    const { a, projectA } = await world();
    const staff = await makeUser();
    await addMember(staff, a.id, "seo_specialist");
    await expect(authorize(staff, { projectId: projectA.id }, "seo.view")).resolves.toBeTruthy();
  });

  it("does not let a client user do things their role forbids", async () => {
    const { a, agencyA, projectA } = await world();
    const clientUser = await makeUser();
    await addMember(clientUser, a.id, "client");
    await prisma().projectMembership.create({
      data: {
        agencyId: agencyA.id,
        clientId: a.id,
        projectId: projectA.id,
        userId: clientUser.userId,
      },
    });
    await expect(
      authorize(clientUser, { projectId: projectA.id }, "content.create"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("listAgenciesWith", () => {
  it("lists only the agencies where the user holds the permission", async () => {
    const { agencyA, agencyB } = await world();
    const user = await makeUser();
    await addAgencyStaff(user, agencyA.id, "agency_admin");
    await addAgencyStaff(user, agencyB.id, "reviewer");
    expect((await listAgenciesWith(user, "agency.members")).map((x) => x.id)).toEqual([agencyA.id]);
    expect(await listAgenciesWith(await makeUser(), "agency.members")).toEqual([]);
  });
});
