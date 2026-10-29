import { beforeEach, describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import {
  addAgencyStaff,
  addMember,
  makeAgency,
  makeClient,
  makeUser,
  prisma,
  resetDb,
} from "../../test/helpers";
import {
  acceptInvitation,
  acceptInvitationWithNewAccount,
  hashToken,
  inviteMember,
  listTeam,
  previewInvitation,
  removeAgencyMember,
  removeClientMember,
  revokeInvitation,
  setAgencyMemberRoles,
  setClientMemberRoles,
  setUserActive,
} from "./team";

beforeEach(resetDb);

async function setup() {
  const agencyA = await makeAgency("Agency A");
  const agencyB = await makeAgency("Agency B");
  const a = await makeClient("Client A", "client-a", agencyA.id);
  const b = await makeClient("Client B", "client-b", agencyB.id);
  const adminA = await makeUser();
  await addAgencyStaff(adminA, agencyA.id, "agency_admin", true);
  const adminB = await makeUser();
  await addAgencyStaff(adminB, agencyB.id, "agency_admin", true);
  return { agencyA, agencyB, a, b, adminA, adminB };
}

const actions = async (action: string) => prisma().auditLog.findMany({ where: { action } });

describe("inviting", () => {
  it("stores only a hash of the token and audits the invitation", async () => {
    const { agencyA, adminA } = await setup();
    const { invitation, token } = await inviteMember(adminA, {
      agencyId: agencyA.id,
      email: "New.Person@Example.com",
      roleKeys: ["seo_specialist", "content_writer"],
    });
    expect(invitation.email).toBe("new.person@example.com");
    expect(invitation.tokenHash).toBe(hashToken(token));
    expect(invitation.tokenHash).not.toContain(token);
    expect(JSON.stringify(await prisma().invitation.findMany())).not.toContain(token);
    const [audit] = await actions("invitation.created");
    expect(audit).toMatchObject({ actorUserId: adminA.userId, agencyId: agencyA.id });
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it("replaces an older pending invitation for the same person", async () => {
    const { agencyA, adminA } = await setup();
    const input = { agencyId: agencyA.id, email: "x@example.com", roleKeys: ["reviewer" as const] };
    const first = await inviteMember(adminA, input);
    await inviteMember(adminA, input);
    const stored = await prisma().invitation.findUniqueOrThrow({
      where: { id: first.invitation.id },
    });
    expect(stored.status).toBe("revoked");
    expect(await prisma().invitation.count({ where: { status: "pending" } })).toBe(1);
  });

  it("requires the agency.members permission for agency-wide invitations", async () => {
    const { agencyA, a } = await setup();
    const manager = await makeUser();
    await addMember(manager, a.id, "seo_manager");
    await expect(
      inviteMember(manager, {
        agencyId: agencyA.id,
        email: "x@example.com",
        roleKeys: ["reviewer"],
      }),
    ).rejects.toBeInstanceOf(NotFoundError); // has no agency-level seat roles at all
    const staff = await makeUser();
    await addAgencyStaff(staff, agencyA.id, "seo_manager", true);
    await expect(
      inviteMember(staff, { agencyId: agencyA.id, email: "x@example.com", roleKeys: ["reviewer"] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lets a client's SEO Manager invite people to that client only, and not above their own level", async () => {
    const { agencyA, a } = await setup();
    const a2 = await makeClient("Client A2", "client-a2", agencyA.id);
    const manager = await makeUser();
    await addMember(manager, a.id, "seo_manager");

    const ok = await inviteMember(manager, {
      agencyId: agencyA.id,
      clientId: a.id,
      email: "c@example.com",
      roleKeys: ["client"],
    });
    expect(ok.invitation.clientId).toBe(a.id);
    await expect(
      inviteMember(manager, {
        agencyId: agencyA.id,
        clientId: a2.id,
        email: "c@example.com",
        roleKeys: ["client"],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      inviteMember(manager, {
        agencyId: agencyA.id,
        clientId: a.id,
        email: "c@example.com",
        roleKeys: ["agency_admin"],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("does not let an admin of another agency invite into this one (id swapping)", async () => {
    const { agencyA, a, adminB } = await setup();
    await expect(
      inviteMember(adminB, {
        agencyId: agencyA.id,
        email: "x@example.com",
        roleKeys: ["reviewer"],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      inviteMember(adminB, {
        agencyId: agencyA.id,
        clientId: a.id,
        email: "x@example.com",
        roleKeys: ["reviewer"],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects the Client role for agency-wide invitations and existing team members", async () => {
    const { agencyA, adminA } = await setup();
    await expect(
      inviteMember(adminA, { agencyId: agencyA.id, email: "x@example.com", roleKeys: ["client"] }),
    ).rejects.toBeInstanceOf(ValidationError);
    const colleague = await makeUser();
    await addAgencyStaff(colleague, agencyA.id, "reviewer");
    const user = await prisma().user.findUniqueOrThrow({ where: { id: colleague.userId } });
    await expect(
      inviteMember(adminA, { agencyId: agencyA.id, email: user.email, roleKeys: ["reviewer"] }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("revokes invitations only inside the agency that owns them", async () => {
    const { agencyA, agencyB, adminA, adminB } = await setup();
    const { invitation } = await inviteMember(adminA, {
      agencyId: agencyA.id,
      email: "x@example.com",
      roleKeys: ["reviewer"],
    });
    await expect(revokeInvitation(adminB, agencyB.id, invitation.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(revokeInvitation(adminB, agencyA.id, invitation.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(
      (await prisma().invitation.findUniqueOrThrow({ where: { id: invitation.id } })).status,
    ).toBe("pending");
    await revokeInvitation(adminA, agencyA.id, invitation.id);
    expect(
      (await prisma().invitation.findUniqueOrThrow({ where: { id: invitation.id } })).status,
    ).toBe("revoked");
    expect(await actions("invitation.revoked")).toHaveLength(1);
  });
});

describe("accepting", () => {
  it("creates the account, grants the invited roles, audits it, and works only once", async () => {
    const { agencyA, adminA } = await setup();
    const { token } = await inviteMember(adminA, {
      agencyId: agencyA.id,
      email: "new@example.com",
      roleKeys: ["seo_specialist", "content_writer"],
      allClientsAccess: true,
    });
    expect(await previewInvitation(token)).toMatchObject({
      usable: true,
      email: "new@example.com",
      agencyName: "Agency A",
    });

    const { userId } = await acceptInvitationWithNewAccount({
      token,
      name: "New Person",
      passwordHash: "hash",
    });
    const seat = await prisma().agencyMembership.findFirstOrThrow({
      where: { userId },
      include: { roles: { include: { role: true } } },
    });
    expect(seat.roles.map((r) => r.role.key).sort()).toEqual(["content_writer", "seo_specialist"]);
    expect(seat.allClientsAccess).toBe(true);
    const user = await prisma().user.findUniqueOrThrow({ where: { id: userId } });
    expect(user).toMatchObject({ email: "new@example.com", emailVerified: true, isAdmin: false });
    expect((await actions("invitation.accepted"))[0]).toMatchObject({ actorUserId: userId });

    await expect(
      acceptInvitationWithNewAccount({ token, name: "Again", passwordHash: "h" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await previewInvitation(token)).toMatchObject({ usable: false });
  });

  it("cannot be used after it expires or is revoked", async () => {
    const { agencyA, adminA } = await setup();
    const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const old = await inviteMember(
      adminA,
      { agencyId: agencyA.id, email: "a@example.com", roleKeys: ["reviewer"] },
      past,
    );
    await expect(
      acceptInvitationWithNewAccount({ token: old.token, name: "A", passwordHash: "h" }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const fresh = await inviteMember(adminA, {
      agencyId: agencyA.id,
      email: "b@example.com",
      roleKeys: ["reviewer"],
    });
    await revokeInvitation(adminA, agencyA.id, fresh.invitation.id);
    await expect(
      acceptInvitationWithNewAccount({ token: fresh.token, name: "B", passwordHash: "h" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      acceptInvitationWithNewAccount({ token: "not-a-real-token", name: "C", passwordHash: "h" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("only lets the invited email accept while signed in, and leaves the invitation usable otherwise", async () => {
    const { agencyA, adminA } = await setup();
    const person = await makeUser();
    const stranger = await makeUser();
    const email = (await prisma().user.findUniqueOrThrow({ where: { id: person.userId } })).email;
    const { token } = await inviteMember(adminA, {
      agencyId: agencyA.id,
      email,
      roleKeys: ["reviewer"],
    });

    await expect(acceptInvitation(stranger.userId, token)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await prisma().agencyMembership.count({ where: { userId: stranger.userId } })).toBe(0);
    expect((await prisma().invitation.findFirstOrThrow()).status).toBe("pending");

    await acceptInvitation(person.userId, token);
    expect(await prisma().agencyMembership.count({ where: { userId: person.userId } })).toBe(1);
  });

  it("refuses to create a second account for an existing email", async () => {
    const { agencyA, adminA } = await setup();
    const existing = await makeUser();
    const email = (await prisma().user.findUniqueOrThrow({ where: { id: existing.userId } })).email;
    const { token } = await inviteMember(adminA, {
      agencyId: agencyA.id,
      email,
      roleKeys: ["reviewer"],
    });
    await expect(
      acceptInvitationWithNewAccount({ token, name: "X", passwordHash: "h" }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await prisma().invitation.findFirstOrThrow()).status).toBe("pending");
  });

  it("grants a client invitation as a client-level membership with the Client role", async () => {
    const { agencyA, a, adminA } = await setup();
    const { token } = await inviteMember(adminA, {
      agencyId: agencyA.id,
      clientId: a.id,
      email: "c@example.com",
      roleKeys: ["client"],
    });
    const { userId } = await acceptInvitationWithNewAccount({
      token,
      name: "Client Person",
      passwordHash: "h",
    });
    const seat = await prisma().clientMembership.findFirstOrThrow({
      where: { userId, clientId: a.id },
      include: { roles: { include: { role: true } } },
    });
    expect(seat.roles.map((r) => r.role.key)).toEqual(["client"]);
    const agencySeat = await prisma().agencyMembership.findFirstOrThrow({
      where: { userId },
      include: { roles: true },
    });
    expect(agencySeat.roles).toEqual([]); // no agency-wide powers
    expect(agencySeat.allClientsAccess).toBe(false);
  });
});

describe("changing and removing people", () => {
  it("changes roles, audits before/after, and refuses roles from the wrong level", async () => {
    const { agencyA, adminA } = await setup();
    const member = await makeUser();
    await addAgencyStaff(member, agencyA.id, "reviewer");
    await setAgencyMemberRoles(adminA, {
      agencyId: agencyA.id,
      userId: member.userId,
      roleKeys: ["seo_specialist", "content_writer"],
    });
    const [audit] = await actions("membership.roles_changed");
    expect(audit?.before).toMatchObject({ roles: ["reviewer"] });
    expect(audit?.after).toMatchObject({ roles: ["seo_specialist", "content_writer"] });
    await expect(
      setAgencyMemberRoles(adminA, {
        agencyId: agencyA.id,
        userId: member.userId,
        roleKeys: ["client"],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("keeps at least one Agency Admin", async () => {
    const { agencyA, adminA } = await setup();
    await expect(
      setAgencyMemberRoles(adminA, {
        agencyId: agencyA.id,
        userId: adminA.userId,
        roleKeys: ["reviewer"],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(removeAgencyMember(adminA, agencyA.id, adminA.userId)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("does not let a non-admin change roles or escalate", async () => {
    const { agencyA } = await setup();
    const staff = await makeUser();
    await addAgencyStaff(staff, agencyA.id, "seo_manager", true);
    const other = await makeUser();
    await addAgencyStaff(other, agencyA.id, "reviewer");
    await expect(
      setAgencyMemberRoles(staff, {
        agencyId: agencyA.id,
        userId: other.userId,
        roleKeys: ["agency_admin"],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      setAgencyMemberRoles(staff, {
        agencyId: agencyA.id,
        userId: staff.userId,
        roleKeys: ["agency_admin"],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("cannot reach people in another agency by swapping ids", async () => {
    const { agencyA, adminA, adminB } = await setup();
    await expect(
      setAgencyMemberRoles(adminA, {
        agencyId: agencyA.id,
        userId: adminB.userId,
        roleKeys: ["reviewer"],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(removeAgencyMember(adminA, agencyA.id, adminB.userId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await prisma().agencyMembership.count({ where: { userId: adminB.userId } })).toBe(1);
  });

  it("removes a member, returns their work to the pool and drops their client access", async () => {
    const { agencyA, a, adminA } = await setup();
    const member = await makeUser();
    await addMember(member, a.id, "seo_specialist");
    const task = await prisma().task.create({
      data: { agencyId: agencyA.id, clientId: a.id, title: "T", assigneeId: member.userId },
    });
    await removeAgencyMember(adminA, agencyA.id, member.userId);
    expect(
      (await prisma().task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId,
    ).toBeNull();
    expect(await prisma().clientMembership.count({ where: { userId: member.userId } })).toBe(0);
    expect(await actions("membership.removed")).toHaveLength(1);
  });

  it("manages per-client roles with member.manage and stays inside the client", async () => {
    const { agencyA, a, b, adminB } = await setup();
    const manager = await makeUser();
    await addMember(manager, a.id, "seo_manager");
    const writer = await makeUser();
    await addMember(writer, a.id, "content_writer");
    await setClientMemberRoles(manager, {
      clientId: a.id,
      userId: writer.userId,
      roleKeys: ["content_writer", "reviewer"],
    });
    await expect(
      setClientMemberRoles(manager, {
        clientId: a.id,
        userId: writer.userId,
        roleKeys: ["agency_admin"],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      setClientMemberRoles(manager, {
        clientId: b.id,
        userId: writer.userId,
        roleKeys: ["reviewer"],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(removeClientMember(adminB, a.id, writer.userId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const task = await prisma().task.create({
      data: { agencyId: agencyA.id, clientId: a.id, title: "T", assigneeId: writer.userId },
    });
    await removeClientMember(manager, a.id, writer.userId);
    expect(
      (await prisma().task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId,
    ).toBeNull();
  });

  it("lists the team for admins only, and never exposes token hashes", async () => {
    const { agencyA, agencyB, adminA, adminB } = await setup();
    await inviteMember(adminA, {
      agencyId: agencyA.id,
      email: "x@example.com",
      roleKeys: ["reviewer"],
    });
    const team = await listTeam(adminA, agencyA.id);
    expect(team.members).toHaveLength(1);
    expect(team.invitations).toHaveLength(1);
    expect(JSON.stringify(team)).not.toContain("tokenHash");
    await expect(listTeam(adminB, agencyA.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listTeam(adminB, agencyB.id)).invitations).toHaveLength(0);
  });
});

describe("deactivating accounts", () => {
  it("is for platform admins, ends sessions and blocks access", async () => {
    const { a, adminA } = await setup();
    const platform = await makeUser(true);
    await prisma().session.create({
      data: { userId: adminA.userId, token: "t", expiresAt: new Date(Date.now() + 1e6) },
    });
    await expect(setUserActive(adminA, adminA.userId, false)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await setUserActive(platform, adminA.userId, false);
    expect(await prisma().session.count({ where: { userId: adminA.userId } })).toBe(0);
    const { getClientContext } = await import("../access");
    await expect(getClientContext(adminA, a.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await actions("user.deactivated")).toHaveLength(1);
    await setUserActive(platform, adminA.userId, true);
    await expect(getClientContext(adminA, a.id)).resolves.toBeTruthy();
  });
});
