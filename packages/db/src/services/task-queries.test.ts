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
import { NotFoundError } from "../errors";
import { endOfDayInTimeZone } from "../dates";
import {
  BOARD_COLUMNS,
  getBoard,
  getCalendar,
  getReviewQueue,
  getTaskCounts,
  getTaskDetail,
  getTaskFormOptions,
  getWorkload,
  searchTasks,
} from "./task-queries";
import { addDependency, assignTask, createTask, logTime, transitionTask } from "./tasks";

beforeEach(resetDb);

async function world() {
  const agencyA = await makeAgency("Agency A");
  const agencyB = await makeAgency("Agency B");
  const a = await makeClient("Client A", "client-a", agencyA.id);
  await prisma().client.update({ where: { id: a.id }, data: { timezone: "America/Toronto" } });
  const a2 = await makeClient("Client A2", "client-a2", agencyA.id);
  const b = await makeClient("Client B", "client-b", agencyB.id);
  const t = (c: { id: string; agencyId: string }) => ({ agencyId: c.agencyId, clientId: c.id });
  const manager = await makeUser();
  await addMember(manager, a.id, "seo_manager");
  const worker = await makeUser();
  await addMember(worker, a.id, "seo_specialist");
  const idle = await makeUser();
  await addMember(idle, a.id, "content_writer");
  const reviewer = await makeUser();
  await addMember(reviewer, a.id, "reviewer");
  const clientUser = await makeUser();
  await addMember(clientUser, a.id, "client");
  const adminB = await makeUser();
  await addAgencyStaff(adminB, agencyB.id, "agency_admin", true);
  const mk = (extra: Record<string, unknown> = {}) =>
    createTask(manager, { clientId: a.id, title: "Task", ...extra } as never);
  return { agencyA, a, a2, b, manager, worker, idle, reviewer, clientUser, adminB, t, mk };
}

const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort();

describe("overdue calculation", () => {
  it("counts unfinished tasks past their due date and nothing else", async () => {
    const { a, manager, worker, t } = await world();
    const now = new Date("2026-05-10T12:00:00Z");
    const mk = (title: string, status: string, dueAt: Date | null) =>
      prisma().task.create({
        data: {
          ...t(a),
          title,
          status: status as never,
          dueAt,
          assigneeId: worker.userId,
          completedAt: status === "completed" ? now : null,
        },
      });
    await mk("late open", "in_progress", new Date("2026-05-09T00:00:00Z"));
    await mk("late in review", "ready_for_review", new Date("2026-05-09T00:00:00Z"));
    await mk("late blocked", "blocked", new Date("2026-05-09T00:00:00Z"));
    await mk("late completed", "completed", new Date("2026-05-09T00:00:00Z"));
    await mk("late cancelled", "cancelled", new Date("2026-05-09T00:00:00Z"));
    await mk("future", "in_progress", new Date("2026-05-11T00:00:00Z"));
    await mk("no date", "in_progress", null);
    const overdue = await searchTasks(manager, { overdue: true, now });
    expect(titles(overdue.rows)).toEqual(["late blocked", "late in review", "late open"]);
    expect(overdue.rows.every((r) => r.overdue)).toBe(true);
    const all = await searchTasks(manager, { now });
    expect(all.rows.filter((r) => r.overdue)).toHaveLength(3);
    expect((await getTaskCounts(manager)).overdue).toBeGreaterThanOrEqual(0);
  });

  it("is judged by the end of the due DAY in the client's time zone", async () => {
    const { manager, a, worker, t } = await world();
    const dueAt = endOfDayInTimeZone("2026-05-10", "America/Toronto"); // 2026-05-11T03:59:59.999Z
    await prisma().task.create({
      data: {
        ...t(a),
        title: "due Sunday",
        status: "in_progress",
        dueAt,
        assigneeId: worker.userId,
      },
    });
    // 01:00 UTC on the 11th is still Sunday evening in Toronto: not overdue yet.
    expect(
      (await searchTasks(manager, { overdue: true, now: new Date("2026-05-11T01:00:00Z") })).total,
    ).toBe(0);
    expect(
      (await searchTasks(manager, { overdue: true, now: new Date("2026-05-11T04:00:00Z") })).total,
    ).toBe(1);
  });
});

describe("task lists", () => {
  it("filters by status, priority, assignee, text and open/closed, with paging", async () => {
    const { manager, worker, a, mk, t } = await world();
    for (let i = 0; i < 22; i++)
      await prisma().task.create({
        data: {
          ...t(a),
          title: `Bulk ${i}`,
          assigneeId: i % 2 ? worker.userId : null,
          status: i % 2 ? "assigned" : "backlog",
        },
      });
    await mk({ title: "Fix canonical tags", priority: "urgent", description: "duplicate content" });
    const all = await searchTasks(manager);
    expect(all).toMatchObject({ total: 23, pageCount: 2 });
    expect((await searchTasks(manager, { page: 2 })).rows).toHaveLength(3);
    expect((await searchTasks(manager, { priority: "urgent" })).rows.map((r) => r.title)).toEqual([
      "Fix canonical tags",
    ]);
    expect((await searchTasks(manager, { q: "duplicate" })).total).toBe(1);
    expect((await searchTasks(manager, { assignee: worker.userId })).total).toBe(11);
    expect((await searchTasks(manager, { assignee: "none" })).total).toBe(12);
    expect((await searchTasks(worker, { assignee: "me" })).total).toBe(11);
    expect((await searchTasks(manager, { status: "assigned" })).total).toBe(11);
    expect((await searchTasks(manager, { q: "'; drop table tasks;--" })).total).toBe(0);
  });

  it("only shows the actor's tenants and permitted clients", async () => {
    const { manager, adminB, clientUser, a, a2, b, t } = await world();
    await prisma().task.create({ data: { ...t(a), title: "mine" } });
    await prisma().task.create({ data: { ...t(a2), title: "other client, same agency" } });
    await prisma().task.create({ data: { ...t(b), title: "other agency" } });
    expect(titles((await searchTasks(manager)).rows)).toEqual(["mine"]); // manager belongs to client A only
    expect(titles((await searchTasks(adminB)).rows)).toEqual(["other agency"]);
    expect((await searchTasks(clientUser)).rows).toEqual([]); // the Client role has no task.view
    expect((await searchTasks(manager, { clientId: b.id })).rows).toEqual([]);
  });
});

describe("kanban board", () => {
  it("has a column per status with counts, newest completed only, and no cancelled column", async () => {
    const { manager, worker, a, t } = await world();
    const now = new Date("2026-05-10T12:00:00Z");
    const mk = (status: string, extra: Record<string, unknown> = {}) =>
      prisma().task.create({
        data: {
          ...t(a),
          title: status,
          status: status as never,
          assigneeId: status === "backlog" ? null : worker.userId,
          ...extra,
        },
      });
    for (const s of [
      "backlog",
      "assigned",
      "in_progress",
      "changes_requested",
      "blocked",
      "ready_for_review",
      "approved",
    ])
      await mk(s);
    await mk("completed", { completedAt: new Date("2026-05-05T00:00:00Z") });
    await prisma().task.create({
      data: {
        ...t(a),
        title: "ancient",
        status: "completed",
        completedAt: new Date("2025-01-01"),
        assigneeId: worker.userId,
      },
    });
    await mk("cancelled");
    const board = await getBoard(manager, { now });
    expect(board.columns.map((c) => c.status)).toEqual(BOARD_COLUMNS);
    for (const column of board.columns) expect(column.total, column.status).toBe(1);
    expect(board.columns.flatMap((c) => c.cards).some((c) => c.status === "cancelled")).toBe(false);
  });

  it("offers each person only the moves they can really make", async () => {
    const { manager, worker, idle, reviewer, mk } = await world();
    const task = await mk({ assigneeId: worker.userId });
    await transitionTask(worker, task.id, { to: "in_progress" });
    await transitionTask(worker, task.id, { to: "ready_for_review", evidence: { note: "done" } });
    const movesFor = async (actor: typeof worker) =>
      (await getBoard(actor)).columns
        .find((c) => c.status === "ready_for_review")!
        .cards[0]?.moves.map((m) => m.to)
        .sort();
    expect(await movesFor(reviewer)).toEqual(["approved", "changes_requested"]);
    expect(await movesFor(worker)).toEqual(["in_progress"]); // can withdraw, cannot approve or cancel
    expect(await movesFor(idle)).toEqual([]);
    expect((await movesFor(manager))?.sort()).toEqual([
      "approved",
      "cancelled",
      "changes_requested",
      "in_progress",
    ]);
  });
});

describe("calendar", () => {
  it("places tasks on their due day in the client's time zone and counts undated work", async () => {
    const { manager, worker, a, t } = await world();
    const mk = (title: string, dueAt: Date | null, status = "assigned") =>
      prisma().task.create({
        data: {
          ...t(a),
          title,
          dueAt,
          status: status as never,
          assigneeId: worker.userId,
          completedAt: status === "completed" ? new Date() : null,
        },
      });
    await mk("late evening, 10th", endOfDayInTimeZone("2026-05-10", "America/Toronto")); // 03:59 UTC on the 11th
    await mk("the 12th", endOfDayInTimeZone("2026-05-12", "America/Toronto"));
    await mk("last day of April", endOfDayInTimeZone("2026-04-30", "America/Toronto"));
    await mk("no date", null);
    const cal = await getCalendar(manager, "2026-05", { now: new Date("2026-05-11T05:00:00Z") });
    expect(cal.days).toHaveLength(31);
    expect(cal.byDay.get("2026-05-10")?.map((x) => x.title)).toEqual(["late evening, 10th"]);
    expect(cal.byDay.get("2026-05-12")?.map((x) => x.title)).toEqual(["the 12th"]);
    expect([...cal.byDay.keys()].some((d) => d.startsWith("2026-04"))).toBe(false);
    expect(cal.byDay.get("2026-05-10")?.[0]?.overdue).toBe(true);
    expect(cal.byDay.get("2026-05-12")?.[0]?.overdue).toBe(false);
    expect(cal.undated).toBe(1);
  });
});

describe("team workload", () => {
  it("shows open, overdue, due soon, review, blocked, estimate and logged time per person, including people with no work", async () => {
    const { manager, worker, idle, a, t, mk } = await world();
    const now = new Date("2026-05-10T12:00:00Z");
    const mkt = (
      title: string,
      status: string,
      due: string | null,
      estimateMinutes: number | null,
    ) =>
      prisma().task.create({
        data: {
          ...t(a),
          title,
          status: status as never,
          assigneeId: worker.userId,
          dueAt: due ? new Date(due) : null,
          estimateMinutes,
          completedAt: status === "completed" ? now : null,
        },
      });
    await mkt("late", "in_progress", "2026-05-09T00:00:00Z", 60);
    await mkt("soon", "assigned", "2026-05-12T00:00:00Z", 30);
    await mkt("review", "ready_for_review", null, null);
    await mkt("blocked", "blocked", "2026-05-20T00:00:00Z", 90);
    await mkt("finished", "completed", "2026-05-01T00:00:00Z", 500);
    await mk({ title: "nobody" });
    const own = await mk({ assigneeId: worker.userId });
    await logTime(worker, own.id, { minutes: 25 });
    const load = await getWorkload(manager, { now });
    const row = load.rows.find((r) => r.userId === worker.userId)!;
    expect(row).toMatchObject({
      open: 5,
      overdue: 1,
      dueThisWeek: 1,
      inReview: 1,
      blocked: 1,
      estimateMinutes: 180,
      loggedMinutes7d: 25,
    });
    expect(load.rows.find((r) => r.userId === idle.userId)).toMatchObject({ open: 0, overdue: 0 }); // listed although idle
    expect(load.unassigned.open).toBe(1);
    expect(load.canReassign).toBe(true);
    expect((await getWorkload(worker)).canReassign).toBe(false);
  });

  it("does not include other tenants' people or work", async () => {
    const { manager, adminB, b, t } = await world();
    await prisma().task.create({
      data: { ...t(b), title: "B's", assigneeId: adminB.userId, status: "assigned" },
    });
    const load = await getWorkload(manager);
    expect(load.rows.find((r) => r.userId === adminB.userId)).toBeUndefined();
  });
});

describe("review queue", () => {
  async function queued() {
    const w = await world();
    const task = await w.mk({ assigneeId: w.worker.userId });
    await transitionTask(w.worker, task.id, { to: "in_progress" });
    await transitionTask(w.worker, task.id, {
      to: "ready_for_review",
      evidence: { note: "ready" },
    });
    return { ...w, task };
  }

  it("lists tasks waiting for review, oldest first, for people who can review", async () => {
    const { reviewer, manager, a, worker, t, task } = await queued();
    const older = await prisma().task.create({
      data: {
        ...t(a),
        title: "older",
        status: "ready_for_review",
        assigneeId: worker.userId,
        reviewRequestedAt: new Date("2020-01-01"),
      },
    });
    const queue = await getReviewQueue(reviewer);
    expect(queue.rows.map((r) => r.id)).toEqual([older.id, task.id]);
    expect((await getReviewQueue(manager)).total).toBe(2);
    expect(queue.rows.every((r) => !r.ownWork)).toBe(true);
    expect((await getReviewQueue(manager)).rows.every((r) => !r.ownWork)).toBe(true);
    expect((await getTaskCounts(reviewer)).review).toBe(2);
  });

  it("is empty for people who cannot review, and flags your own work", async () => {
    const { worker, idle, clientUser, adminB, a, manager, t } = await queued();
    expect((await getReviewQueue(worker)).rows).toEqual([]);
    expect((await getReviewQueue(idle)).rows).toEqual([]);
    expect((await getReviewQueue(clientUser)).rows).toEqual([]);
    expect((await getReviewQueue(adminB)).rows).toEqual([]);
    const mine = await prisma().task.create({
      data: {
        ...t(a),
        title: "mine",
        status: "ready_for_review",
        assigneeId: manager.userId,
        reviewRequestedAt: new Date(),
      },
    });
    expect((await getReviewQueue(manager)).rows.find((r) => r.id === mine.id)?.ownWork).toBe(true);
    expect((await getTaskCounts(worker)).canReview).toBe(false);
  });
});

describe("task detail", () => {
  it("returns the whole record: relations, history, time, and what this person may do", async () => {
    const { manager, worker, mk, a, t } = await world();
    const dep = await mk({ title: "Prerequisite" });
    const task = await mk({ title: "Main", assigneeId: worker.userId, estimateMinutes: 120 });
    await addDependency(manager, task.id, dep.id);
    await logTime(worker, task.id, { minutes: 50 });
    const item = await prisma().contentItem.create({
      data: { ...t(a), title: "Post", type: "blog_post", channel: "website" },
    });
    await prisma().task.update({ where: { id: task.id }, data: { contentItemId: item.id } });

    const asWorker = await getTaskDetail(worker, task.id);
    expect(asWorker.task.dependencies.map((d) => d.dependsOnTask.title)).toEqual(["Prerequisite"]);
    expect(asWorker.task.contentItem?.title).toBe("Post");
    expect(asWorker.loggedMinutes).toBe(50);
    expect(asWorker.openDependencies).toBe(1);
    expect(asWorker.moves.find((m) => m.to === "in_progress")?.disabledReason).toMatch(
      /Waiting for 1/,
    );
    expect(asWorker.permissions).toMatchObject({
      canEdit: true,
      canLogTime: true,
      canComment: true,
      canAssign: false,
      canManage: false,
    });
    expect(asWorker.task.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["created", "dependency_added", "time_logged"]),
    );
    expect(asWorker.assignable).toEqual([]);

    const asManager = await getTaskDetail(manager, task.id);
    expect(asManager.permissions).toMatchObject({ canAssign: true, canManage: true });
    expect(asManager.assignable.map((p) => p.id)).toContain(worker.userId);
  });

  it("is not found for other tenants and for people without task access", async () => {
    const { adminB, clientUser, mk } = await world();
    const task = await mk();
    await expect(getTaskDetail(adminB, task.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getTaskDetail(clientUser, task.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getTaskDetail(adminB, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("shows a reviewer the review moves and read-only fields", async () => {
    const { reviewer, worker, mk } = await world();
    const task = await mk({ assigneeId: worker.userId });
    await transitionTask(worker, task.id, { to: "in_progress" });
    await transitionTask(worker, task.id, { to: "ready_for_review", evidence: { note: "x" } });
    const d = await getTaskDetail(reviewer, task.id);
    expect(d.moves.map((m) => m.to).sort()).toEqual(["approved", "changes_requested"]);
    expect(d.permissions).toMatchObject({ canEdit: false, canLogTime: false, canComment: true });
  });

  it("self-claim is offered to doers on unassigned tasks", async () => {
    const { worker, mk } = await world();
    const task = await mk();
    expect((await getTaskDetail(worker, task.id)).permissions.selfClaim).toBe(true);
    await assignTask(worker, task.id, worker.userId);
    expect((await getTaskDetail(worker, task.id)).permissions.selfClaim).toBe(false);
  });
});

describe("task form options", () => {
  it("lists this client's projects, content, open issues and people who can do tasks", async () => {
    const { manager, a, a2, t, reviewer, worker, adminB } = await world();
    await prisma().project.create({ data: { ...t(a), name: "Mine", slug: "mine" } });
    await prisma().project.create({ data: { ...t(a2), name: "Not mine", slug: "other" } });
    const o = await getTaskFormOptions(manager, a.id);
    expect(o.projects.map((p) => p.name)).toEqual(["Mine"]);
    expect(o.people.map((p) => p.id)).toEqual(
      expect.arrayContaining([worker.userId, manager.userId]),
    );
    expect(o.people.map((p) => p.id)).not.toContain(reviewer.userId);
    expect(o).toMatchObject({ canCreate: true, canAssign: true });
    await expect(getTaskFormOptions(adminB, a.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
