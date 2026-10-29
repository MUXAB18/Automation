import { beforeEach, describe, expect, it } from "vitest";
import {
  addAgencyStaff,
  addMember,
  makeAgency,
  makeClient,
  makeUser,
  prisma,
  resetDb,
} from "../../test/helpers";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import {
  createProject,
  getProjectDetail,
  getProjectForEdit,
  listClientsForProjects,
  listProjectCandidates,
  searchProjects,
  setProjectStatus,
  updateProject,
} from "./projects";

beforeEach(resetDb);

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
  const a = await makeClient("Client A", "client-a", agencyA.id);
  const a2 = await makeClient("Client A2", "client-a2", agencyA.id);
  const b = await makeClient("Client B", "client-b", agencyB.id);
  const t = (c: { id: string; agencyId: string }) => ({ agencyId: c.agencyId, clientId: c.id });
  const siteA = await prisma().website.create({
    data: { ...t(a), domain: "a.com", isPrimary: true },
  });
  const siteA2 = await prisma().website.create({ data: { ...t(a2), domain: "a2.com" } });
  const manager = await makeUser();
  await addMember(manager, a.id, "seo_manager");
  const adminA = await makeUser();
  await addAgencyStaff(adminA, agencyA.id, "agency_admin", true);
  const adminB = await makeUser();
  await addAgencyStaff(adminB, agencyB.id, "agency_admin", true);
  const worker = await makeUser();
  await addMember(worker, a.id, "seo_specialist");
  return { agencyA, agencyB, a, a2, b, siteA, siteA2, manager, adminA, adminB, worker, t };
}

const counts = async () => ({
  projects: await prisma().project.count(),
  memberships: await prisma().projectMembership.count(),
  seoProjects: await prisma().seoProject.count(),
  keywords: await prisma().keyword.count(),
  calendars: await prisma().contentCalendar.count(),
  clientSeats: await prisma().clientMembership.count(),
});

describe("creating a project", () => {
  it("creates the project, people, SEO setup and social setup together", async () => {
    const { manager, worker, a, siteA, agencyA } = await world();
    const before = await counts();
    const project = await createProject(manager, {
      clientId: a.id,
      name: "Spring Campaign",
      kind: "seo",
      goals: "Double organic leads",
      startsOn: "2026-03-01" as never,
      endsOn: "2026-06-30" as never,
      memberIds: [worker.userId, manager.userId],
      seo: {
        websiteId: siteA.id,
        targetCountry: "ca",
        targetLanguage: "en",
        keywords: "Freight Forwarding\nfreight forwarding, Customs Broker",
        organicSessionsGoal: 5000,
        topTenKeywordsGoal: 10,
      } as never,
      social: {
        channels: ["linkedin", "facebook"],
        postsPerWeek: 4,
        requirements: "Always include a CTA",
      } as never,
    });
    const stored = await prisma().project.findUniqueOrThrow({
      where: { id: project.id },
      include: {
        projectMemberships: true,
        seoProject: { include: { keywords: true } },
        contentCalendars: true,
      },
    });
    expect(stored).toMatchObject({
      agencyId: agencyA.id,
      clientId: a.id,
      slug: "spring-campaign",
      kind: "seo",
      goals: "Double organic leads",
      createdById: manager.userId,
    });
    expect(stored.startsOn?.toISOString().slice(0, 10)).toBe("2026-03-01");
    expect(stored.projectMemberships.map((m) => m.userId).sort()).toEqual(
      [manager.userId, worker.userId].sort(),
    );
    expect(stored.seoProject).toMatchObject({
      websiteId: siteA.id,
      targetCountry: "CA",
      targetLanguage: "en",
    });
    expect(stored.seoProject?.keywords.map((k) => k.term).sort()).toEqual([
      "customs broker",
      "freight forwarding",
    ]);
    expect((stored.seoProject?.settings as { targets: object }).targets).toEqual({
      organicSessionsGoal: 5000,
      topTenKeywordsGoal: 10,
    });
    expect(stored.settings).toMatchObject({
      social: { channels: ["linkedin", "facebook"], postsPerWeek: 4 },
    });
    expect(stored.contentCalendars).toHaveLength(1);
    const after = await counts();
    expect(after.projects - before.projects).toBe(1);
    expect(after.keywords - before.keywords).toBe(2);
    const [audit] = await prisma().auditLog.findMany({ where: { action: "project.created" } });
    expect(audit).toMatchObject({
      entityId: project.id,
      clientId: a.id,
      actorUserId: manager.userId,
    });
  });

  it("numbers duplicate names instead of failing", async () => {
    const { manager, a } = await world();
    const one = await createProject(manager, { clientId: a.id, name: "Same" });
    const two = await createProject(manager, { clientId: a.id, name: "Same" });
    expect([one.slug, two.slug]).toEqual(["same", "same-2"]);
  });

  it("is all-or-nothing when the SEO website belongs to another client", async () => {
    const { manager, worker, a, siteA2 } = await world();
    const before = await counts();
    const errors = await fieldErrors(
      createProject(manager, {
        clientId: a.id,
        name: "Broken",
        memberIds: [worker.userId],
        seo: { websiteId: siteA2.id, keywords: "one two" } as never,
        social: { channels: ["x"], postsPerWeek: 2 } as never,
      }),
    );
    expect(errors["seo.websiteId"]).toBeDefined();
    expect(await counts()).toEqual(before);
  });

  it("is all-or-nothing when someone assigned does not work on the client", async () => {
    const { manager, a, adminB, worker } = await world();
    const before = await counts();
    expect(
      (
        await fieldErrors(
          createProject(manager, {
            clientId: a.id,
            name: "X",
            memberIds: [worker.userId, adminB.userId],
          }),
        )
      ).memberIds,
    ).toBeDefined();
    expect(await counts()).toEqual(before);
  });

  it("seats agency-wide staff on the client when they are assigned", async () => {
    const { manager, a, adminA } = await world();
    expect(
      await prisma().clientMembership.count({ where: { clientId: a.id, userId: adminA.userId } }),
    ).toBe(0);
    const project = await createProject(manager, {
      clientId: a.id,
      name: "With admin",
      memberIds: [adminA.userId],
    });
    expect(
      await prisma().projectMembership.count({
        where: { projectId: project.id, userId: adminA.userId },
      }),
    ).toBe(1);
    expect(
      await prisma().clientMembership.count({ where: { clientId: a.id, userId: adminA.userId } }),
    ).toBe(1);
  });

  it("validates dates, kind requirements, lengths and counts", async () => {
    const { manager, a, siteA } = await world();
    const errors = await fieldErrors(
      createProject(manager, {
        clientId: a.id,
        name: "",
        goals: "g".repeat(4001),
        startsOn: "2026-05-01" as never,
        endsOn: "2026-04-01" as never,
        kind: "social",
      }),
    );
    expect(Object.keys(errors).sort()).toEqual(["endsOn", "goals", "name", "social.channels"]);
    expect(
      Object.keys(
        await fieldErrors(createProject(manager, { clientId: a.id, name: "SEO", kind: "seo" })),
      ),
    ).toEqual(["seo.websiteId"]);
    const bad = await fieldErrors(
      createProject(manager, {
        clientId: a.id,
        name: "Bad",
        seo: {
          websiteId: siteA.id,
          targetCountry: "Canada",
          targetLanguage: "english",
          keywords: Array.from({ length: 101 }, (_, i) => `keyword ${i}`),
        } as never,
        social: { channels: ["myspace"], postsPerWeek: 0 } as never,
      }),
    );
    expect(Object.keys(bad).sort()).toEqual([
      "seo.keywords",
      "seo.targetCountry",
      "seo.targetLanguage",
      "social.channels.0",
      "social.postsPerWeek",
    ]);
  });
});

describe("project permissions", () => {
  it("needs project.manage, and seo.manage for SEO targets", async () => {
    const { a, worker, siteA, manager } = await world();
    const reviewer = await makeUser();
    await addMember(reviewer, a.id, "reviewer");
    await expect(createProject(reviewer, { clientId: a.id, name: "No" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(createProject(worker, { clientId: a.id, name: "No" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    // A role that may manage projects but not SEO.
    const role = await prisma().role.findFirstOrThrow({
      where: { agencyId: a.agencyId, key: "seo_manager" },
    });
    const seoManage = await prisma().permission.findUniqueOrThrow({ where: { key: "seo.manage" } });
    await prisma().rolePermission.delete({
      where: { roleId_permissionId: { roleId: role.id, permissionId: seoManage.id } },
    });
    await expect(
      createProject(manager, {
        clientId: a.id,
        name: "SEO?",
        seo: { websiteId: siteA.id } as never,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createProject(manager, { clientId: a.id, name: "Plain" })).resolves.toBeTruthy();
  });

  it("does not cross tenants: other agencies and other clients' projects", async () => {
    const { a, a2, b, manager, adminB, t } = await world();
    await expect(createProject(adminB, { clientId: a.id, name: "Intrude" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      createProject(manager, { clientId: a2.id, name: "Wrong client" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const theirs = await prisma().project.create({ data: { ...t(b), name: "B", slug: "b" } });
    const mine = await createProject(manager, { clientId: a.id, name: "Mine" });
    for (const op of [
      () => updateProject(manager, theirs.id, { name: "Hijack" } as never),
      () => setProjectStatus(manager, theirs.id, "archived"),
      () => getProjectDetail(manager, theirs.id),
      () => getProjectForEdit(manager, theirs.id),
    ]) {
      await expect(op()).rejects.toBeInstanceOf(NotFoundError);
    }
    expect((await prisma().project.findUniqueOrThrow({ where: { id: theirs.id } })).name).toBe("B");
    expect(mine.clientId).toBe(a.id);
  });

  it("lists the clients where projects can be created", async () => {
    const { manager, adminA, a, a2 } = await world();
    expect((await listClientsForProjects(manager)).map((c) => c.id)).toEqual([a.id]);
    expect((await listClientsForProjects(adminA)).map((c) => c.id).sort()).toEqual(
      [a.id, a2.id].sort(),
    );
  });

  it("lists assignable people only to people who manage projects", async () => {
    const { a, worker, manager, adminA } = await world();
    const names = (await listProjectCandidates(manager, a.id)).map((p) => p.userId);
    expect(names).toEqual(expect.arrayContaining([worker.userId, manager.userId, adminA.userId]));
    await expect(listProjectCandidates(worker, a.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("updating and archiving a project", () => {
  it("changes fields and people, keeps keyword history, and audits before/after", async () => {
    const { manager, worker, a, siteA } = await world();
    const project = await createProject(manager, {
      clientId: a.id,
      name: "Plan",
      kind: "seo",
      memberIds: [worker.userId],
      seo: { websiteId: siteA.id, keywords: "alpha, beta" } as never,
    });
    await updateProject(manager, project.id, {
      name: "Plan renamed",
      kind: "seo",
      goals: "New goal",
      memberIds: [manager.userId],
      seo: { websiteId: siteA.id, keywords: "beta, gamma" } as never,
    });
    const stored = await prisma().project.findUniqueOrThrow({
      where: { id: project.id },
      include: { projectMemberships: true, seoProject: { include: { keywords: true } } },
    });
    expect(stored).toMatchObject({ name: "Plan renamed", goals: "New goal", slug: "plan" });
    expect(stored.projectMemberships.map((m) => m.userId)).toEqual([manager.userId]);
    const state = Object.fromEntries(stored.seoProject!.keywords.map((k) => [k.term, k.isActive]));
    expect(state).toEqual({ alpha: false, beta: true, gamma: true }); // alpha kept for history, switched off
    const audits = await prisma().auditLog.findMany({ where: { action: "project.updated" } });
    expect((audits[0]?.before as { name: string }).name).toBe("Plan");
    expect((audits[0]?.after as { members: number }).members).toBe(1);
  });

  it("rejects an update that breaks a rule without changing anything", async () => {
    const { manager, a, siteA2, siteA } = await world();
    const project = await createProject(manager, { clientId: a.id, name: "Keep" });
    await expect(
      updateProject(manager, project.id, {
        name: "Changed",
        seo: { websiteId: siteA2.id },
      } as never),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      updateProject(manager, project.id, {
        name: "Changed",
        startsOn: "2026-02-01",
        endsOn: "2026-01-01",
      } as never),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await prisma().project.findUniqueOrThrow({ where: { id: project.id } })).name).toBe(
      "Keep",
    );
    expect(await prisma().seoProject.count()).toBe(0);
    expect(siteA.id).toBeDefined();
  });

  it("archives and restores, hiding archived projects from the default list", async () => {
    const { manager, a, worker } = await world();
    const project = await createProject(manager, { clientId: a.id, name: "Old" });
    await setProjectStatus(manager, project.id, "archived");
    expect(
      (await prisma().project.findUniqueOrThrow({ where: { id: project.id } })).archivedAt,
    ).not.toBeNull();
    expect((await searchProjects(manager)).total).toBe(0);
    expect((await searchProjects(manager, { archived: true })).total).toBe(1);
    await expect(setProjectStatus(worker, project.id, "active")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await setProjectStatus(manager, project.id, "active");
    expect((await searchProjects(manager)).total).toBe(1);
    expect(
      (await prisma().auditLog.findMany({ where: { action: "project.status_changed" } })).length,
    ).toBe(2);
  });
});

describe("listing projects", () => {
  it("searches, filters, pages and flags what can be managed", async () => {
    const { manager, worker, a, a2, adminA, t } = await world();
    for (let i = 0; i < 22; i++)
      await prisma().project.create({
        data: { ...t(a), name: `Bulk ${String(i).padStart(2, "0")}`, slug: `bulk-${i}` },
      });
    await prisma().project.create({
      data: {
        ...t(a2),
        name: "Social push",
        slug: "social",
        kind: "social",
        status: "paused",
        goals: "More followers",
      },
    });
    const first = await searchProjects(adminA);
    expect(first).toMatchObject({ total: 23, pageCount: 2 });
    expect((await searchProjects(adminA, { page: 2 })).rows).toHaveLength(3);
    expect((await searchProjects(adminA, { kind: "social" })).rows.map((p) => p.name)).toEqual([
      "Social push",
    ]);
    expect((await searchProjects(adminA, { status: "paused" })).total).toBe(1);
    expect((await searchProjects(adminA, { q: "followers" })).total).toBe(1); // matches goals
    expect((await searchProjects(adminA, { q: "client a2" })).total).toBe(1); // matches client name
    expect((await searchProjects(adminA, { clientId: a2.id })).total).toBe(1);
    expect((await searchProjects(manager)).rows.every((p) => p.canManage)).toBe(true);
    expect((await searchProjects(worker)).rows.every((p) => !p.canManage)).toBe(true);
    expect((await searchProjects(adminA, { q: "'; drop table projects;--" })).total).toBe(0);
  });
});

describe("project detail", () => {
  async function seeded() {
    const w = await world();
    const project = await createProject(w.manager, {
      clientId: w.a.id,
      name: "Detail",
      kind: "seo",
      memberIds: [w.worker.userId],
      seo: { websiteId: w.siteA.id, keywords: "alpha" } as never,
      social: { channels: ["linkedin"], postsPerWeek: 2 } as never,
    });
    const tenant = w.t(w.a);
    await prisma().task.create({ data: { ...tenant, projectId: project.id, title: "Do it" } });
    await prisma().contentItem.create({
      data: {
        ...tenant,
        projectId: project.id,
        title: "Post",
        type: "social_post",
        channel: "linkedin",
      },
    });
    const seo = await prisma().seoProject.findFirstOrThrow({ where: { projectId: project.id } });
    const kw = await prisma().keyword.findFirstOrThrow({ where: { seoProjectId: seo.id } });
    await prisma().keywordRankSnapshot.create({
      data: {
        ...tenant,
        keywordId: kw.id,
        source: "manual",
        checkedOn: new Date("2026-01-01"),
        position: 4,
      },
    });
    await prisma().seoIssue.create({
      data: {
        ...tenant,
        seoProjectId: seo.id,
        ruleKey: "title",
        fingerprint: "f1",
        severity: "high",
        title: "Missing title",
      },
    });
    return { ...w, project };
  }

  it("links tasks, content, issues, ranks and people to the project", async () => {
    const { manager, project } = await seeded();
    const d = await getProjectDetail(manager, project.id);
    expect(d.project.projectMemberships).toHaveLength(1);
    expect(d.tasks?.open.map((t) => t.title)).toEqual(["Do it"]);
    expect(d.content?.items.map((c) => c.title)).toEqual(["Post"]);
    expect(d.seo?.issues?.map((i) => i.title)).toEqual(["Missing title"]);
    expect(d.seo?.avgPosition).toBe(4);
    expect(d.social).toMatchObject({ channels: ["linkedin"], postsPerWeek: 2 });
    expect(d.canManage).toBe(true);
    expect(d.activity[0]?.action).toBe("project.created");
  });

  it("includes only the sections the role may see", async () => {
    const { project, a } = await seeded();
    const writer = await makeUser();
    await addMember(writer, a.id, "content_writer"); // tasks + content + seo.view, no analytics
    const d = await getProjectDetail(writer, project.id);
    expect(d.tasks).not.toBeNull();
    expect(d.content).not.toBeNull();
    expect(d.metrics).toBeNull();
    expect(d.canManage).toBe(false);
    const reviewer = await makeUser();
    await addMember(reviewer, a.id, "client");
    await prisma().projectMembership.create({
      data: {
        agencyId: a.agencyId,
        clientId: a.id,
        projectId: project.id,
        userId: reviewer.userId,
      },
    });
    const asClient = await getProjectDetail(reviewer, project.id);
    expect(asClient.tasks).toBeNull();
    expect(asClient.seo?.keywords).toBeNull(); // client role has no seo.view
  });

  it("is invisible to Client users not on the project, and to other tenants", async () => {
    const { project, a, adminB } = await seeded();
    const outsider = await makeUser();
    await addMember(outsider, a.id, "client");
    await expect(getProjectDetail(outsider, project.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getProjectDetail(adminB, project.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
