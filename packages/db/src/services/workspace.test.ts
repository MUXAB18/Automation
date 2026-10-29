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
import {
  PAGE_SIZE,
  getAnalytics,
  getIntegrations,
  getOverview,
  getPublishing,
  getSeoWorkspace,
  listAutomationRules,
  listContent,
  listNotifications,
  listProjectOptions,
  listProjects,
  listReports,
  listTasks,
  markNotificationsRead,
} from "./workspace";

beforeEach(resetDb);

async function world() {
  const agencyA = await makeAgency("Agency A");
  const agencyB = await makeAgency("Agency B");
  const a1 = await makeClient("Client A1", "a1", agencyA.id);
  const a2 = await makeClient("Client A2", "a2", agencyA.id);
  const b = await makeClient("Client B", "b", agencyB.id);
  const t = (c: { id: string; agencyId: string }) => ({ agencyId: c.agencyId, clientId: c.id });
  const projA1 = await prisma().project.create({ data: { ...t(a1), name: "A1 SEO", slug: "seo" } });
  const projA1b = await prisma().project.create({
    data: { ...t(a1), name: "A1 Social", slug: "social" },
  });
  const projA2 = await prisma().project.create({ data: { ...t(a2), name: "A2 SEO", slug: "seo" } });
  const projB = await prisma().project.create({ data: { ...t(b), name: "B SEO", slug: "seo" } });
  const mk = (
    c: { id: string; agencyId: string },
    title: string,
    projectId: string | null,
    extra = {},
  ) => prisma().task.create({ data: { ...t(c), title, projectId, ...extra } });
  await mk(a1, "A1 task in SEO", projA1.id);
  await mk(a1, "A1 task in Social", projA1b.id);
  await mk(a1, "A1 task with no project", null);
  await mk(a2, "A2 task", projA2.id);
  await mk(b, "B secret task", projB.id);
  const staff = await makeUser();
  await addAgencyStaff(staff, agencyA.id, "agency_admin", true);
  const admin = await makeUser(true);
  return { agencyA, agencyB, a1, a2, b, projA1, projA1b, projA2, projB, staff, admin, t };
}

const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort();

describe("tenant isolation", () => {
  it("returns only the actor's agency, even when another tenant's client or project id is supplied", async () => {
    const { staff, b, projB } = await world();
    expect(titles((await listTasks(staff)).rows)).toEqual([
      "A1 task in SEO",
      "A1 task in Social",
      "A1 task with no project",
      "A2 task",
    ]);
    expect((await listTasks(staff, { clientId: b.id })).rows).toEqual([]);
    expect((await listTasks(staff, { projectId: projB.id })).rows).toEqual([]);
    expect((await listProjects(staff, { clientId: b.id })).rows).toEqual([]);
    expect(await listProjectOptions(staff, b.id)).toEqual([]);
  });

  it("lets platform admins see every agency", async () => {
    const { admin } = await world();
    expect((await listTasks(admin)).total).toBe(5);
  });

  it("limits a per-client role to that client", async () => {
    const { a1 } = await world();
    const specialist = await makeUser();
    await addMember(specialist, a1.id, "seo_specialist");
    const tasks = await listTasks(specialist);
    expect(titles(tasks.rows)).toEqual([
      "A1 task in SEO",
      "A1 task in Social",
      "A1 task with no project",
    ]);
  });

  it("filters by selected project", async () => {
    const { staff, projA1 } = await world();
    expect(titles((await listTasks(staff, { projectId: projA1.id })).rows)).toEqual([
      "A1 task in SEO",
    ]);
  });
});

describe("section permissions", () => {
  it("excludes clients where the role lacks the section permission", async () => {
    const { a1 } = await world();
    const writer = await makeUser();
    await addMember(writer, a1.id, "content_writer"); // task.view + content.view, no analytics/report/integration/automation
    expect((await listTasks(writer)).total).toBe(3);
    expect((await getAnalytics(writer)).sources).toEqual([]);
    expect((await listReports(writer)).rows).toEqual([]);
    expect((await listAutomationRules(writer)).rows).toEqual([]);
    expect((await getIntegrations(writer)).accounts).toEqual([]);
    const overview = await getOverview(writer);
    expect(overview.sections).toMatchObject({ tasks: true, content: true, integrations: false });
  });

  it("combines permissions per client (SEO on one client, content on another)", async () => {
    const { a1, a2 } = await world();
    const user = await makeUser();
    await addMember(user, a1.id, "reviewer");
    await addMember(user, a2.id, "seo_manager");
    expect((await getOverview(user)).sections.integrations).toBe(true); // from a2 only
    const accounts = await getIntegrations(user, { clientId: a1.id });
    expect(accounts.accounts).toEqual([]); // a1 lacks integration.manage
  });
});

describe("client-role users see only their projects", () => {
  it("hides other projects and project-less rows", async () => {
    const { a1, agencyA, projA1, projA1b } = await world();
    const clientUser = await makeUser();
    await addMember(clientUser, a1.id, "client");
    await prisma().projectMembership.create({
      data: {
        agencyId: agencyA.id,
        clientId: a1.id,
        projectId: projA1.id,
        userId: clientUser.userId,
      },
    });
    expect(titles((await listTasks(clientUser)).rows)).toEqual([]); // client role has no task.view
    const projects = await listProjects(clientUser);
    expect(projects.rows.map((p) => p.name)).toEqual(["A1 SEO"]);
    expect((await listProjects(clientUser, { clientId: a1.id })).total).toBe(1);
    expect(await listProjectOptions(clientUser, a1.id)).toEqual([
      { id: projA1.id, name: "A1 SEO", isSample: false },
    ]);
    expect(projA1b.id).not.toBe(projA1.id);
  });

  it("applies the same limit to content", async () => {
    const { a1, agencyA, projA1, projA1b } = await world();
    const clientUser = await makeUser();
    await addMember(clientUser, a1.id, "client");
    await prisma().projectMembership.create({
      data: {
        agencyId: agencyA.id,
        clientId: a1.id,
        projectId: projA1.id,
        userId: clientUser.userId,
      },
    });
    const item = (title: string, projectId: string | null) =>
      prisma().contentItem.create({
        data: {
          agencyId: agencyA.id,
          clientId: a1.id,
          projectId,
          title,
          type: "blog_post",
          channel: "website",
        },
      });
    await item("In my project", projA1.id);
    await item("In another project", projA1b.id);
    await item("No project", null);
    expect(titles((await listContent(clientUser)).rows)).toEqual(["In my project"]);
    expect((await listContent(clientUser, { projectId: projA1b.id })).rows).toEqual([]);
  });
});

describe("filters and paging", () => {
  it("searches, filters and pages", async () => {
    const { staff, a1, t } = await world();
    for (let i = 0; i < 25; i++)
      await prisma().task.create({ data: { ...t(a1), title: `Bulk ${i}`, status: "done" } });
    const first = await listTasks(staff, { q: "bulk" });
    expect(first.total).toBe(25);
    expect(first.rows).toHaveLength(PAGE_SIZE);
    expect(first.pageCount).toBe(2);
    expect((await listTasks(staff, { q: "bulk", page: 2 })).rows).toHaveLength(5);
    expect((await listTasks(staff, { status: "done" })).total).toBe(25);
    expect((await listTasks(staff, { open: true })).total).toBe(4);
    expect((await listTasks(staff, { q: "%'; drop table tasks;--" })).total).toBe(0);
    expect((await listTasks(staff, { page: -5 })).page).toBe(1);
  });

  it("filters to the actor's own tasks", async () => {
    const { staff, a1, t } = await world();
    await prisma().task.create({ data: { ...t(a1), title: "Mine", assigneeId: staff.userId } });
    expect(titles((await listTasks(staff, { mine: true })).rows)).toEqual(["Mine"]);
  });
});

describe("section read models", () => {
  it("never selects integration credentials", async () => {
    const { staff, a1, t } = await world();
    const integration = await prisma().integration.create({
      data: { key: "linkedin", name: "LinkedIn", category: "social", authType: "oauth2" },
    });
    await prisma().integrationAccount.create({
      data: {
        ...t(a1),
        integrationId: integration.id,
        externalAccountId: "x",
        scopes: [],
        encryptedCredentials: createTokenCipherForTests().encrypt("t", "c"),
      },
    });
    const result = await getIntegrations(staff);
    expect(result.accounts).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/encrypted|v1\./);
    expect((await getPublishing(staff)).connectedAccounts).toBe(1);
  });

  it("shows another agency's accounts to nobody else", async () => {
    const { staff, b, t } = await world();
    const integration = await prisma().integration.create({
      data: { key: "linkedin", name: "LinkedIn", category: "social", authType: "oauth2" },
    });
    await prisma().integrationAccount.create({
      data: {
        ...t(b),
        integrationId: integration.id,
        externalAccountId: "x",
        scopes: [],
        encryptedCredentials: createTokenCipherForTests().encrypt("t", "c"),
      },
    });
    expect((await getIntegrations(staff)).accounts).toEqual([]);
    expect((await getPublishing(staff)).connectedAccounts).toBe(0);
  });

  it("returns keywords with only their latest rank", async () => {
    const { staff, a1, projA1, t } = await world();
    const site = await prisma().website.create({ data: { ...t(a1), domain: "a1.com" } });
    const seo = await prisma().seoProject.create({
      data: { ...t(a1), projectId: projA1.id, websiteId: site.id },
    });
    const kw = await prisma().keyword.create({
      data: { ...t(a1), seoProjectId: seo.id, term: "freight", isSample: true },
    });
    const snap = (day: string, position: number) =>
      prisma().keywordRankSnapshot.create({
        data: { ...t(a1), keywordId: kw.id, source: "manual", checkedOn: new Date(day), position },
      });
    await snap("2026-01-01", 12);
    await snap("2026-01-08", 8);
    const seoData = await getSeoWorkspace(staff);
    expect(seoData.keywords.rows).toHaveLength(1);
    expect(Number(seoData.keywords.rows[0]?.keywordRankSnapshots[0]?.position)).toBe(8);
    expect(seoData.keywords.rows[0]?.isSample).toBe(true);
    expect(
      (
        await getSeoWorkspace(staff, {
          clientId: (await prisma().client.findFirstOrThrow({ where: { slug: "b" } })).id,
        })
      ).keywords.rows,
    ).toEqual([]);
  });
});

describe("overview", () => {
  it("counts only what the actor may see and flags sample data", async () => {
    const { staff, a1, t } = await world();
    await prisma().task.create({
      data: {
        ...t(a1),
        title: "Late",
        dueAt: new Date(Date.now() - 86_400_000),
        assigneeId: staff.userId,
        isSample: true,
      },
    });
    await prisma().task.create({ data: { ...t(a1), title: "Done", status: "done" } });
    const o = await getOverview(staff);
    expect(o.tasks).toMatchObject({ open: 5, overdue: 1, mineCount: 1 });
    expect(o.sample.tasks).toBe(1);
    expect(o.clients.active).toBe(2);
  });

  it("is empty for a user with no access", async () => {
    await world();
    const nobody = await makeUser();
    const o = await getOverview(nobody);
    expect(o.sections).toEqual({ tasks: false, content: false, seo: false, integrations: false });
    expect(o.tasks.open).toBe(0);
    expect(o.clients.active).toBe(0);
    expect(o.activity).toEqual([]);
  });

  it("respects the selected client", async () => {
    const { staff, a2 } = await world();
    expect((await getOverview(staff, { clientId: a2.id })).tasks.open).toBe(1);
  });
});

describe("notifications", () => {
  it("lists only the actor's own and marks only those read", async () => {
    const { staff, agencyA, a1 } = await world();
    const other = await makeUser();
    const n = (userId: string, title: string, clientId?: string) =>
      prisma().notification.create({
        data: { agencyId: agencyA.id, clientId: clientId ?? null, userId, type: "x", title },
      });
    await n(staff.userId, "mine");
    await n(other.userId, "theirs");
    const before = await listNotifications(staff);
    expect(before.items.map((i) => i.title)).toEqual(["mine"]);
    expect(before.unread).toBe(1);
    await markNotificationsRead(staff);
    expect((await listNotifications(staff)).unread).toBe(0);
    expect(
      await prisma().notification.count({ where: { userId: other.userId, readAt: null } }),
    ).toBe(1);
    void a1;
  });

  it("hides client notifications once the user loses access to that client", async () => {
    const { agencyA, a1 } = await world();
    const user = await makeUser();
    const seat = await addMember(user, a1.id, "reviewer");
    await prisma().notification.create({
      data: {
        agencyId: agencyA.id,
        clientId: a1.id,
        userId: user.userId,
        type: "x",
        title: "about a1",
      },
    });
    expect((await listNotifications(user)).items).toHaveLength(1);
    await prisma().clientMembership.delete({ where: { id: seat.id } });
    expect((await listNotifications(user)).items).toHaveLength(0);
  });
});
