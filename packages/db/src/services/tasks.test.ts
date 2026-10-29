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
import {
  addAttachment,
  addComment,
  addDependency,
  assignTask,
  createTask,
  createTaskForAutomation,
  deleteComment,
  deleteTimeEntry,
  editComment,
  getAttachmentForDownload,
  logTime,
  reassignOpenTasks,
  removeAttachment,
  removeDependency,
  transitionTask,
  updateTask,
} from "./tasks";
import { TASK_STATUSES, TRANSITIONS, type TaskStatusName } from "./task-rules";

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
  await prisma().client.update({ where: { id: a.id }, data: { timezone: "America/Toronto" } });
  const a2 = await makeClient("Client A2", "client-a2", agencyA.id);
  const b = await makeClient("Client B", "client-b", agencyB.id);
  const tenant = (c: { id: string; agencyId: string }) => ({
    agencyId: c.agencyId,
    clientId: c.id,
  });

  const manager = await makeUser();
  await addMember(manager, a.id, "seo_manager"); // task.manage + task.assign + task.review
  const worker = await makeUser();
  await addMember(worker, a.id, "seo_specialist"); // task.manage
  const writer = await makeUser();
  await addMember(writer, a.id, "content_writer"); // task.manage
  const reviewer = await makeUser();
  await addMember(reviewer, a.id, "reviewer"); // task.review only
  const clientUser = await makeUser();
  await addMember(clientUser, a.id, "client"); // no task permissions
  const adminB = await makeUser();
  await addAgencyStaff(adminB, agencyB.id, "agency_admin", true);

  const projectA = await prisma().project.create({
    data: { ...tenant(a), name: "PA", slug: "pa" },
  });
  const projectB = await prisma().project.create({
    data: { ...tenant(b), name: "PB", slug: "pb" },
  });
  const make = (extra: Record<string, unknown> = {}) =>
    createTask(manager, { clientId: a.id, title: "Write the thing", ...extra } as never);
  return {
    agencyA,
    a,
    a2,
    b,
    manager,
    worker,
    writer,
    reviewer,
    clientUser,
    adminB,
    projectA,
    projectB,
    tenant,
    make,
  };
}

const events = (taskId: string) =>
  prisma().taskEvent.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } });
const notes = (userId: string, type?: string) =>
  prisma().notification.findMany({ where: { userId, ...(type ? { type } : {}) } });
const force = (taskId: string, status: TaskStatusName, extra: Record<string, unknown> = {}) =>
  prisma().task.update({
    where: { id: taskId },
    data: { status, completedAt: status === "completed" ? new Date() : null, ...extra },
  });

describe("creating a task", () => {
  it("stores the task, starts it in the backlog, and records history and audit", async () => {
    const { a, manager, projectA, make } = await world();
    const task = await make({
      description: "Details",
      acceptanceCriteria: "Page live\nMeta set",
      type: "seo_fix",
      priority: "high",
      projectId: projectA.id,
      dueDate: "2026-01-15",
      estimateMinutes: 90,
      labels: "seo, quick",
    });
    expect(task).toMatchObject({
      clientId: a.id,
      status: "backlog",
      assigneeId: null,
      reporterId: manager.userId,
      type: "seo_fix",
      priority: "high",
      estimateMinutes: 90,
      source: "manual",
      projectId: projectA.id,
    });
    expect(task.acceptanceCriteria).toBe("Page live\nMeta set");
    expect(task.labels).toEqual(["seo", "quick"]);
    // The due DAY ends at midnight in the client's time zone (Toronto), not the server's.
    expect(task.dueAt?.toISOString()).toBe("2026-01-16T04:59:59.999Z");
    expect((await events(task.id)).map((e) => e.type)).toEqual(["created"]);
    const [audit] = await prisma().auditLog.findMany({ where: { action: "task.created" } });
    expect(audit).toMatchObject({ entityId: task.id, clientId: a.id, actorUserId: manager.userId });
  });

  it("is assigned straight away when someone is chosen, and tells them", async () => {
    const { worker, manager, make } = await world();
    const task = await make({ assigneeId: worker.userId });
    expect(task.status).toBe("assigned");
    expect(task.assigneeId).toBe(worker.userId);
    expect((await notes(worker.userId, "task.assigned")).map((n) => n.entityId)).toEqual([task.id]);
    expect(await notes(manager.userId)).toEqual([]); // the person who acted is not notified
  });

  it("validates every field", async () => {
    const { manager, a, make } = await world();
    const errors = await fieldErrors(
      createTask(manager, {
        clientId: a.id,
        title: " ",
        dueDate: "15/01/2026",
        estimateMinutes: 0,
        description: "d".repeat(10001),
        acceptanceCriteria: "c".repeat(4001),
        labels: Array.from({ length: 11 }, (_, i) => `l${i}`),
        type: "nonsense" as never,
      }),
    );
    expect(Object.keys(errors).sort()).toEqual([
      "acceptanceCriteria",
      "description",
      "dueDate",
      "estimateMinutes",
      "labels",
      "title",
      "type",
    ]);
    expect((await fieldErrors(make({ title: "t".repeat(201) }))).title).toBeDefined();
    expect((await fieldErrors(make({ estimateMinutes: 60001 }))).estimateMinutes).toBeDefined();
  });

  it("only accepts this client's project, content and SEO issues, and assignable people", async () => {
    const { a2, b, make, tenant, projectB, reviewer, adminB, worker } = await world();
    await expect(make({ projectId: projectB.id })).rejects.toBeInstanceOf(ValidationError);
    const otherProject = await prisma().project.create({
      data: { ...tenant(a2), name: "P2", slug: "p2" },
    });
    expect((await fieldErrors(make({ projectId: otherProject.id }))).projectId).toBeDefined();
    const foreignContent = await prisma().contentItem.create({
      data: { ...tenant(b), title: "x", type: "blog_post", channel: "website" },
    });
    expect(
      (await fieldErrors(make({ contentItemId: foreignContent.id }))).contentItemId,
    ).toBeDefined();
    const site = await prisma().website.create({ data: { ...tenant(b), domain: "b.com" } });
    const proj = await prisma().project.create({ data: { ...tenant(b), name: "S", slug: "s" } });
    const seo = await prisma().seoProject.create({
      data: { ...tenant(b), projectId: proj.id, websiteId: site.id },
    });
    const issue = await prisma().seoIssue.create({
      data: {
        ...tenant(b),
        seoProjectId: seo.id,
        ruleKey: "r",
        fingerprint: "f",
        severity: "low",
        title: "t",
      },
    });
    expect((await fieldErrors(make({ seoIssueIds: [issue.id] }))).seoIssueIds).toBeDefined();
    // Reviewer cannot do tasks; the other agency's admin does not work on this client.
    expect((await fieldErrors(make({ assigneeId: reviewer.userId }))).assigneeId).toBeDefined();
    expect((await fieldErrors(make({ assigneeId: adminB.userId }))).assigneeId).toBeDefined();
    await expect(make({ assigneeId: worker.userId })).resolves.toBeTruthy();
  });

  it("links an SEO issue and a content item, and shows where the task came from", async () => {
    const { a, make, tenant } = await world();
    const site = await prisma().website.create({ data: { ...tenant(a), domain: "a.com" } });
    const proj = await prisma().project.create({ data: { ...tenant(a), name: "S", slug: "s" } });
    const seo = await prisma().seoProject.create({
      data: { ...tenant(a), projectId: proj.id, websiteId: site.id },
    });
    const issue = await prisma().seoIssue.create({
      data: {
        ...tenant(a),
        seoProjectId: seo.id,
        ruleKey: "r",
        fingerprint: "f",
        severity: "high",
        title: "Missing title",
      },
    });
    const item = await prisma().contentItem.create({
      data: { ...tenant(a), title: "Post", type: "blog_post", channel: "website" },
    });
    const task = await make({ seoIssueIds: [issue.id], contentItemId: item.id });
    expect(task.source).toBe("seo_issue");
    expect(task.contentItemId).toBe(item.id);
    expect((await prisma().seoIssue.findUniqueOrThrow({ where: { id: issue.id } })).taskId).toBe(
      task.id,
    );
  });

  it("follows permissions and tenants", async () => {
    const { a, worker, reviewer, clientUser, adminB, writer, manager } = await world();
    const base = { clientId: a.id, title: "T" };
    await expect(createTask(reviewer, base)).rejects.toBeInstanceOf(ForbiddenError); // can review, cannot do tasks
    await expect(createTask(clientUser, base)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createTask(adminB, base)).rejects.toBeInstanceOf(NotFoundError);
    // Doers may take work for themselves but not hand it to others.
    await expect(createTask(worker, { ...base, assigneeId: worker.userId })).resolves.toBeTruthy();
    await expect(createTask(worker, { ...base, assigneeId: writer.userId })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(createTask(manager, { ...base, assigneeId: writer.userId })).resolves.toBeTruthy();
  });
});

describe("status transitions", () => {
  it("carries a task from Backlog to Completed, keeping every step in its history", async () => {
    const { manager, worker, reviewer, make } = await world();
    const task = await make();
    await assignTask(manager, task.id, worker.userId);
    await transitionTask(worker, task.id, { to: "in_progress" });
    await transitionTask(worker, task.id, {
      to: "ready_for_review",
      evidence: { note: "Done, see page", links: "https://example.com/page" },
    });
    const review = await prisma().task.findUniqueOrThrow({ where: { id: task.id } });
    expect(review).toMatchObject({
      status: "ready_for_review",
      evidenceNote: "Done, see page",
      evidenceLinks: ["https://example.com/page"],
    });
    expect(review.reviewRequestedAt).not.toBeNull();
    await transitionTask(reviewer, task.id, { to: "approved" });
    await transitionTask(manager, task.id, { to: "completed" });

    const done = await prisma().task.findUniqueOrThrow({ where: { id: task.id } });
    expect(done.status).toBe("completed");
    expect(done.startedAt).not.toBeNull();
    expect(done.completedAt).not.toBeNull();
    const history = (await events(task.id))
      .filter((e) => e.type === "status_changed")
      .map((e) => [
        e.fromValue,
        (e.toValue as { status?: string } | string).constructor === Object
          ? (e.toValue as { status: string }).status
          : e.toValue,
      ]);
    expect(history).toEqual([
      ["backlog", "assigned"],
      ["assigned", "in_progress"],
      ["in_progress", "ready_for_review"],
      ["ready_for_review", "approved"],
      ["approved", "completed"],
    ]);
    expect((await events(task.id)).map((e) => e.type)).toContain("evidence_submitted");
    expect(
      (await prisma().auditLog.findMany({ where: { action: "task.status_changed" } })).length,
    ).toBe(4);
  });

  it("rejects every move the workflow does not allow, from every status", async () => {
    const { a, manager, worker, tenant } = await world();
    for (const from of TASK_STATUSES) {
      const task = await prisma().task.create({
        data: {
          ...tenant(a),
          title: `from ${from}`,
          status: from,
          assigneeId: worker.userId,
          completedAt: from === "completed" ? new Date() : null,
        },
      });
      for (const to of TASK_STATUSES) {
        if ((TRANSITIONS[from] as readonly string[]).includes(to)) continue;
        await expect(
          transitionTask(manager, task.id, { to, note: "because" }),
          `${from} -> ${to}`,
        ).rejects.toBeInstanceOf(ConflictError);
      }
      expect((await prisma().task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(from);
    }
  });

  it("explains an invalid move in plain words and records nothing", async () => {
    const { manager, make } = await world();
    const task = await make();
    await expect(transitionTask(manager, task.id, { to: "completed" })).rejects.toThrow(
      /"Backlog" cannot move to "Completed"/,
    );
    expect((await events(task.id)).map((e) => e.type)).toEqual(["created"]);
  });

  it("asks for evidence before review: a note, a link, or an attachment", async () => {
    const { manager, worker, make } = await world();
    const task = await make({ assigneeId: worker.userId });
    await transitionTask(worker, task.id, { to: "in_progress" });
    expect(
      (await fieldErrors(transitionTask(worker, task.id, { to: "ready_for_review" }))).evidenceNote,
    ).toBeDefined();
    expect(
      Object.keys(
        await fieldErrors(
          transitionTask(worker, task.id, {
            to: "ready_for_review",
            evidence: { links: "javascript:alert(1)" },
          }),
        ),
      ),
    ).toContain("links.0");
    expect(
      Object.keys(
        await fieldErrors(
          transitionTask(worker, task.id, {
            to: "ready_for_review",
            evidence: { note: "n".repeat(4001) },
          }),
        ),
      ),
    ).toContain("note");
    await expect(
      transitionTask(worker, task.id, {
        to: "ready_for_review",
        evidence: { links: ["https://example.com/a"] },
      }),
    ).resolves.toBeTruthy();
    // An attachment alone is enough evidence.
    const other = await make({ assigneeId: worker.userId });
    await transitionTask(worker, other.id, { to: "in_progress" });
    await addAttachment(worker, other.id, {
      fileName: "proof.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      storageKey: "k1",
      sha256: "a".repeat(64),
    });
    await expect(
      transitionTask(worker, other.id, { to: "ready_for_review" }),
    ).resolves.toBeTruthy();
    void manager;
  });

  it("requires a reason to request changes, block or cancel", async () => {
    const { manager, worker, reviewer, make } = await world();
    const task = await make({ assigneeId: worker.userId });
    await transitionTask(worker, task.id, { to: "in_progress" });
    expect(
      (await fieldErrors(transitionTask(worker, task.id, { to: "blocked" }))).note,
    ).toBeDefined();
    await transitionTask(worker, task.id, { to: "blocked", note: "Waiting on logins" });
    await transitionTask(worker, task.id, { to: "in_progress" });
    await transitionTask(worker, task.id, { to: "ready_for_review", evidence: { note: "done" } });
    expect(
      (await fieldErrors(transitionTask(reviewer, task.id, { to: "changes_requested" }))).note,
    ).toBeDefined();
    await transitionTask(reviewer, task.id, { to: "changes_requested", note: "Fix the title" });
    expect(
      (await fieldErrors(transitionTask(manager, task.id, { to: "cancelled" }))).note,
    ).toBeDefined();
    const last = (await events(task.id)).filter((e) => e.type === "status_changed").at(-1);
    expect(last?.toValue).toEqual({ status: "changes_requested", note: "Fix the title" });
  });

  it("lets reviewers approve or send back, and tells the right people", async () => {
    const { manager, worker, reviewer, make } = await world();
    const task = await make({ assigneeId: worker.userId });
    await transitionTask(worker, task.id, { to: "in_progress" });
    await transitionTask(worker, task.id, { to: "ready_for_review", evidence: { note: "ready" } });
    // Reviewers and managers hear about it; the author does not.
    expect((await notes(reviewer.userId, "task.review_requested")).length).toBe(1);
    expect((await notes(manager.userId, "task.review_requested")).length).toBe(1);
    expect(await notes(worker.userId, "task.review_requested")).toEqual([]);
    await transitionTask(reviewer, task.id, {
      to: "changes_requested",
      note: "More detail please",
    });
    const back = await notes(worker.userId, "task.changes_requested");
    expect(back).toHaveLength(1);
    expect(back[0]?.body).toBe("More detail please");
    await transitionTask(worker, task.id, { to: "in_progress" });
    await transitionTask(worker, task.id, { to: "ready_for_review", evidence: { note: "better" } });
    await transitionTask(reviewer, task.id, { to: "approved" });
    expect((await notes(worker.userId, "task.approved")).length).toBe(1);
    expect(
      (await prisma().task.findUniqueOrThrow({ where: { id: task.id } })).reviewRequestedAt,
    ).not.toBeNull();
  });

  it("enforces who may make each move", async () => {
    const { manager, worker, writer, reviewer, clientUser, make } = await world();
    const task = await make({ assigneeId: worker.userId });
    await expect(transitionTask(writer, task.id, { to: "in_progress" })).rejects.toBeInstanceOf(
      ForbiddenError,
    ); // not the assignee
    await expect(transitionTask(reviewer, task.id, { to: "in_progress" })).rejects.toBeInstanceOf(
      ForbiddenError,
    ); // reviewers review
    await expect(transitionTask(clientUser, task.id, { to: "in_progress" })).rejects.toBeInstanceOf(
      NotFoundError,
    ); // cannot even see tasks
    await expect(transitionTask(manager, task.id, { to: "in_progress" })).resolves.toBeTruthy(); // managers can move anything
    await transitionTask(worker, task.id, { to: "ready_for_review", evidence: { note: "x" } });
    await expect(transitionTask(worker, task.id, { to: "approved" })).rejects.toBeInstanceOf(
      ForbiddenError,
    ); // no task.review
    await expect(
      transitionTask(worker, task.id, { to: "cancelled", note: "no longer needed" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await prisma().task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(
      "ready_for_review",
    );
  });

  it("never lets anyone approve their own work, even a manager", async () => {
    const { manager, make } = await world();
    const task = await make({ assigneeId: manager.userId });
    await transitionTask(manager, task.id, { to: "in_progress" });
    await transitionTask(manager, task.id, { to: "ready_for_review", evidence: { note: "mine" } });
    await expect(transitionTask(manager, task.id, { to: "approved" })).rejects.toThrow(
      /your own work/,
    );
    await expect(
      transitionTask(manager, task.id, { to: "changes_requested", note: "nope" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("waits for dependencies before starting or completing", async () => {
    const { manager, worker, make } = await world();
    const first = await make({ title: "First", assigneeId: worker.userId });
    const second = await make({ title: "Second", assigneeId: worker.userId });
    await addDependency(manager, second.id, first.id);
    await expect(transitionTask(worker, second.id, { to: "in_progress" })).rejects.toThrow(
      /Waiting for: "First"/,
    );
    await transitionTask(worker, first.id, { to: "in_progress" });
    await transitionTask(worker, first.id, { to: "ready_for_review", evidence: { note: "ok" } });
    await transitionTask(manager, first.id, { to: "approved" }).catch(() => undefined);
    await force(first.id, "completed");
    await expect(transitionTask(worker, second.id, { to: "in_progress" })).resolves.toBeTruthy();
  });

  it("cannot be raced: only one of two simultaneous moves wins", async () => {
    const { worker, make } = await world();
    const task = await make({ assigneeId: worker.userId });
    const results = await Promise.allSettled([
      transitionTask(worker, task.id, { to: "in_progress" }),
      transitionTask(worker, task.id, { to: "blocked", note: "stuck on access" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect((await events(task.id)).filter((e) => e.type === "status_changed")).toHaveLength(1);
  });

  it("reopens a cancelled task into the backlog, unassigned", async () => {
    const { manager, worker, make } = await world();
    const task = await make({ assigneeId: worker.userId });
    await transitionTask(manager, task.id, { to: "cancelled", note: "Client changed plans" });
    await expect(assignTask(manager, task.id, manager.userId)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await transitionTask(manager, task.id, { to: "backlog" });
    expect(await prisma().task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      status: "backlog",
      assigneeId: null,
    });
  });

  it("keeps the task and all its history after completion, and refuses further edits", async () => {
    const { manager, worker, make } = await world();
    const task = await make({ assigneeId: worker.userId });
    await force(task.id, "approved", { startedAt: new Date() });
    await transitionTask(manager, task.id, { to: "completed" });
    const before = (await events(task.id)).length;
    await expect(
      updateTask(manager, task.id, { title: "Renamed" } as never),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(assignTask(manager, task.id, null)).rejects.toBeInstanceOf(ConflictError);
    await expect(transitionTask(manager, task.id, { to: "in_progress" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect((await events(task.id)).length).toBe(before);
    await expect(addComment(manager, task.id, "Thanks all")).resolves.toBeTruthy();
  });

  it("keeps completed_at in step with the status in the database itself", async () => {
    const { make } = await world();
    const task = await make();
    await expect(
      prisma().task.update({ where: { id: task.id }, data: { status: "completed" } }),
    ).rejects.toThrow();
    await expect(
      prisma().task.update({ where: { id: task.id }, data: { completedAt: new Date() } }),
    ).rejects.toThrow();
  });
});

describe("assignment", () => {
  it("assigns, reassigns and unassigns, adjusting the status and recording each step", async () => {
    const { manager, worker, writer, make } = await world();
    const task = await make();
    await assignTask(manager, task.id, worker.userId);
    expect(await prisma().task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      status: "assigned",
      assigneeId: worker.userId,
    });
    await transitionTask(worker, task.id, { to: "in_progress" });
    await assignTask(manager, task.id, writer.userId);
    expect(await prisma().task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      status: "assigned",
      assigneeId: writer.userId,
    }); // new person starts afresh
    await assignTask(manager, task.id, null);
    expect(await prisma().task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      status: "backlog",
      assigneeId: null,
    });
    expect((await events(task.id)).map((e) => e.type)).toEqual([
      "created",
      "assigned",
      "status_changed",
      "status_changed",
      "reassigned",
      "status_changed",
      "unassigned",
      "status_changed",
    ]);
    // Both sides hear about a reassignment.
    expect((await notes(writer.userId, "task.assigned")).length).toBe(1);
    expect((await notes(worker.userId, "task.unassigned")).length).toBe(1);
  });

  it("lets doers take an unassigned task but not give or take work from others", async () => {
    const { manager, worker, writer, make } = await world();
    const open = await make();
    await expect(assignTask(worker, open.id, writer.userId)).rejects.toBeInstanceOf(ForbiddenError);
    await assignTask(worker, open.id, worker.userId); // claim
    await expect(assignTask(writer, open.id, writer.userId)).rejects.toBeInstanceOf(ForbiddenError); // already taken
    await expect(assignTask(worker, open.id, null)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(assignTask(manager, open.id, null)).resolves.toBeTruthy();
  });

  it("only assigns people who can do tasks on that client", async () => {
    const { manager, reviewer, adminB, clientUser, make } = await world();
    const task = await make();
    for (const person of [reviewer, adminB, clientUser]) {
      expect(
        (await fieldErrors(assignTask(manager, task.id, person.userId))).assigneeId,
      ).toBeDefined();
    }
  });

  it("answers 'not found' for another tenant's task", async () => {
    const { adminB, worker, make } = await world();
    const task = await make();
    await expect(assignTask(adminB, task.id, worker.userId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      transitionTask(adminB, task.id, { to: "cancelled", note: "intruder" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateTask(adminB, task.id, { title: "x" } as never)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("moves a person's open tasks to someone else where allowed, and reports what it skipped", async () => {
    const { a, a2, manager, worker, writer, make, tenant } = await world();
    await addMember(worker, a2.id, "seo_specialist"); // worker also works on A2, where nobody here can assign
    const t1 = await make({ assigneeId: worker.userId });
    const t2 = await make({ assigneeId: worker.userId });
    await transitionTask(worker, t2.id, { to: "in_progress" });
    const done = await make({ assigneeId: worker.userId });
    await force(done.id, "completed");
    const t3 = await prisma().task.create({
      data: { ...tenant(a2), title: "On A2", assigneeId: worker.userId, status: "assigned" },
    });
    const result = await reassignOpenTasks(manager, {
      fromUserId: worker.userId,
      toUserId: writer.userId,
    });
    expect(result).toEqual({ moved: 2, skipped: 1 });
    expect((await prisma().task.findUniqueOrThrow({ where: { id: t1.id } })).assigneeId).toBe(
      writer.userId,
    );
    expect(await prisma().task.findUniqueOrThrow({ where: { id: t2.id } })).toMatchObject({
      assigneeId: writer.userId,
      status: "assigned",
    });
    expect((await prisma().task.findUniqueOrThrow({ where: { id: done.id } })).assigneeId).toBe(
      worker.userId,
    ); // finished work stays
    expect((await prisma().task.findUniqueOrThrow({ where: { id: t3.id } })).assigneeId).toBe(
      worker.userId,
    ); // not allowed there
    expect((await events(t1.id)).map((e) => e.type)).toContain("reassigned");
    expect(
      (await notes(writer.userId, "task.assigned")).some((n) => n.title.includes("2 tasks")),
    ).toBe(true);
    void a;
  });

  it("refuses a bulk reassignment by someone who cannot assign", async () => {
    const { worker, writer, make } = await world();
    await make({ assigneeId: worker.userId });
    await expect(
      reassignOpenTasks(writer, { fromUserId: worker.userId, toUserId: writer.userId }),
    ).resolves.toEqual({ moved: 0, skipped: 1 });
    expect(await prisma().task.count({ where: { assigneeId: worker.userId } })).toBe(1);
    await expect(
      reassignOpenTasks(writer, { fromUserId: worker.userId, toUserId: worker.userId }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("editing", () => {
  it("lets the assignee and creator edit, managers edit anything, others nothing", async () => {
    const { manager, worker, writer, reviewer, make } = await world();
    const task = await make({ assigneeId: worker.userId });
    const edit = { title: "New title", priority: "urgent" } as never;
    await expect(updateTask(worker, task.id, edit)).resolves.toBeTruthy(); // assignee
    await expect(updateTask(writer, task.id, edit)).rejects.toBeInstanceOf(ForbiddenError); // can do tasks, but not this one
    await expect(updateTask(reviewer, task.id, edit)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateTask(manager, task.id, edit)).resolves.toBeTruthy();
  });

  it("records what changed, and tells the assignee about due date and priority changes", async () => {
    const { manager, worker, make } = await world();
    const task = await make({ assigneeId: worker.userId, dueDate: "2026-02-01", priority: "low" });
    await updateTask(manager, task.id, {
      title: "Write the thing",
      priority: "urgent",
      dueDate: "2026-02-10",
      acceptanceCriteria: "A\nB",
    } as never);
    const types = (await events(task.id)).map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining(["updated", "priority_changed", "due_date_changed"]),
    );
    const due = (await events(task.id)).find((e) => e.type === "due_date_changed");
    expect(due?.toValue).toBe("2026-02-11T04:59:59.999Z");
    expect((await notes(worker.userId, "task.due_changed")).length).toBe(1);
    expect((await notes(worker.userId, "task.priority_changed")).length).toBe(1);
    // An edit that changes nothing records nothing.
    const count = (await events(task.id)).length;
    await updateTask(manager, task.id, {
      title: "Write the thing",
      priority: "urgent",
      dueDate: "2026-02-10",
      acceptanceCriteria: "A\nB",
    } as never);
    expect((await events(task.id)).length).toBe(count);
  });

  it("links and unlinks SEO issues, never stealing one from another task", async () => {
    const { a, manager, make, tenant } = await world();
    const site = await prisma().website.create({ data: { ...tenant(a), domain: "a.com" } });
    const proj = await prisma().project.create({ data: { ...tenant(a), name: "S", slug: "s" } });
    const seo = await prisma().seoProject.create({
      data: { ...tenant(a), projectId: proj.id, websiteId: site.id },
    });
    const issue = await prisma().seoIssue.create({
      data: {
        ...tenant(a),
        seoProjectId: seo.id,
        ruleKey: "r",
        fingerprint: "f",
        severity: "low",
        title: "t",
      },
    });
    const one = await make({ title: "One" });
    const two = await make({ title: "Two" });
    await updateTask(manager, one.id, { title: "One", seoIssueIds: [issue.id] } as never);
    expect(
      (
        await fieldErrors(
          updateTask(manager, two.id, { title: "Two", seoIssueIds: [issue.id] } as never),
        )
      ).seoIssueIds,
    ).toBeDefined();
    await updateTask(manager, one.id, { title: "One", seoIssueIds: [] } as never);
    expect(
      (await prisma().seoIssue.findUniqueOrThrow({ where: { id: issue.id } })).taskId,
    ).toBeNull();
  });
});

describe("comments", () => {
  it("lets people who work on or review the task comment, and notifies the others", async () => {
    const { worker, reviewer, clientUser, make } = await world();
    const task = await make({ assigneeId: worker.userId });
    await addComment(reviewer, task.id, "Looks good so far");
    expect((await notes(worker.userId, "task.comment"))[0]?.body).toBe("Looks good so far");
    await expect(addComment(clientUser, task.id, "hello")).rejects.toBeInstanceOf(NotFoundError);
    expect(await fieldErrors(addComment(worker, task.id, "  "))).toHaveProperty("_form");
    expect((await events(task.id)).map((e) => e.type)).toContain("comment_added");
  });

  it("edits only your own comments and hides (not erases) deleted ones", async () => {
    const { manager, worker, make } = await world();
    const task = await make({ assigneeId: worker.userId });
    const mine = await addComment(worker, task.id, "first");
    await expect(editComment(manager, mine.id, "hacked")).rejects.toBeInstanceOf(ForbiddenError);
    await editComment(worker, mine.id, "second");
    expect(await prisma().taskComment.findUniqueOrThrow({ where: { id: mine.id } })).toMatchObject({
      body: "second",
    });
    await deleteComment(manager, mine.id); // managers may moderate
    const stored = await prisma().taskComment.findUniqueOrThrow({ where: { id: mine.id } });
    expect(stored.deletedAt).not.toBeNull();
    expect(stored.body).toBe("second"); // retained
  });

  it("is invisible across tenants", async () => {
    const { adminB, make } = await world();
    const task = await make();
    await expect(addComment(adminB, task.id, "hi")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("dependencies", () => {
  it("adds and removes dependencies, refusing loops, duplicates, itself and other clients", async () => {
    const { a2, manager, make, tenant } = await world();
    const a = await make({ title: "A" });
    const b = await make({ title: "B" });
    const c = await make({ title: "C" });
    await addDependency(manager, a.id, b.id); // A waits for B
    await addDependency(manager, b.id, c.id); // B waits for C
    await expect(addDependency(manager, c.id, a.id)).rejects.toThrow(/loop/); // C waits for A would close the loop
    await expect(addDependency(manager, b.id, a.id)).rejects.toThrow(/loop/);
    await expect(addDependency(manager, a.id, b.id)).rejects.toThrow(/already waits/);
    expect(Object.keys(await fieldErrors(addDependency(manager, a.id, a.id)))).toContain(
      "dependsOnTaskId",
    );
    const foreign = await prisma().task.create({ data: { ...tenant(a2), title: "other client" } });
    await expect(addDependency(manager, a.id, foreign.id)).rejects.toBeInstanceOf(NotFoundError);
    await removeDependency(manager, a.id, b.id);
    await expect(addDependency(manager, c.id, a.id)).resolves.toBeUndefined();
    await expect(removeDependency(manager, a.id, b.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await events(a.id)).map((e) => e.type)).toEqual(
      expect.arrayContaining(["dependency_added", "dependency_removed"]),
    );
  });

  it("is only for people who can edit the task", async () => {
    const { writer, worker, make } = await world();
    const a = await make({ title: "A", assigneeId: worker.userId });
    const b = await make({ title: "B" });
    await expect(addDependency(writer, a.id, b.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addDependency(worker, a.id, b.id)).resolves.toBeUndefined();
  });
});

describe("time tracking", () => {
  it("records time for the assignee and adds it up", async () => {
    const { manager, worker, writer, make } = await world();
    const task = await make({ assigneeId: worker.userId, estimateMinutes: 120 });
    await logTime(worker, task.id, { minutes: 45, note: "Research", workedOn: "2026-01-05" });
    await logTime(manager, task.id, { minutes: 30 });
    await expect(logTime(writer, task.id, { minutes: 10 })).rejects.toBeInstanceOf(ForbiddenError);
    const entries = await prisma().timeEntry.findMany({ where: { taskId: task.id } });
    expect(entries.reduce((n, e) => n + e.durationSeconds, 0) / 60).toBe(75);
    expect(
      entries.every((e) => e.projectId === task.projectId && e.endedAt && e.endedAt > e.startedAt),
    ).toBe(true);
    expect((await events(task.id)).filter((e) => e.type === "time_logged")).toHaveLength(2);
  });

  it("validates minutes, refuses cancelled tasks, and removes only your own entries", async () => {
    const { manager, worker, make } = await world();
    const task = await make({ assigneeId: worker.userId });
    for (const minutes of [0, 1441, 1.5, "abc"])
      expect(
        (await fieldErrors(logTime(worker, task.id, { minutes } as never))).minutes,
      ).toBeDefined();
    const entry = await logTime(worker, task.id, { minutes: 20 });
    const theirs = await logTime(manager, task.id, { minutes: 5 });
    await expect(deleteTimeEntry(worker, theirs.id)).rejects.toBeInstanceOf(ForbiddenError);
    await deleteTimeEntry(worker, entry.id);
    await deleteTimeEntry(manager, theirs.id);
    await transitionTask(manager, task.id, { to: "cancelled", note: "dropped" });
    await expect(logTime(worker, task.id, { minutes: 5 })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("attachments", () => {
  const file = {
    fileName: "evidence.png",
    mimeType: "image/png",
    sizeBytes: 2048,
    storageKey: "key-1",
    sha256: "b".repeat(64),
  };

  it("records a stored file, validates it, and hides removed ones without deleting history", async () => {
    const { worker, manager, make } = await world();
    const task = await make({ assigneeId: worker.userId });
    const attachment = await addAttachment(worker, task.id, {
      ...file,
      fileName: "../../etc/passwd.png",
    });
    expect(attachment.fileName).not.toContain("/");
    expect(Number(attachment.sizeBytes)).toBe(2048);
    expect(
      (
        await fieldErrors(
          addAttachment(worker, task.id, {
            ...file,
            storageKey: "k2",
            mimeType: "application/x-msdownload",
          }),
        )
      ).mimeType,
    ).toBeDefined();
    expect(
      (
        await fieldErrors(
          addAttachment(worker, task.id, {
            ...file,
            storageKey: "k3",
            sizeBytes: 11 * 1024 * 1024,
          }),
        )
      ).sizeBytes,
    ).toBeDefined();
    expect(
      (
        await fieldErrors(
          addAttachment(worker, task.id, { ...file, storageKey: "k4", sizeBytes: 0 }),
        )
      ).sizeBytes,
    ).toBeDefined();
    await expect(getAttachmentForDownload(manager, attachment.id)).resolves.toMatchObject({
      storageKey: "key-1",
      mimeType: "image/png",
    });
    await removeAttachment(worker, attachment.id);
    await expect(getAttachmentForDownload(manager, attachment.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await events(task.id)).map((e) => e.type)).toContain("attachment_added");
  });

  it("is limited to people who can edit the task, and unreachable from other tenants", async () => {
    const { worker, writer, adminB, clientUser, make } = await world();
    const task = await make({ assigneeId: worker.userId });
    await expect(addAttachment(writer, task.id, file)).rejects.toBeInstanceOf(ForbiddenError);
    const attachment = await addAttachment(worker, task.id, file);
    await expect(getAttachmentForDownload(adminB, attachment.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(getAttachmentForDownload(clientUser, attachment.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(removeAttachment(writer, attachment.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("automation", () => {
  async function withRule(status: "active" | "draft" = "active") {
    const w = await world();
    const rule = await prisma().automationRule.create({
      data: { ...w.tenant(w.a), name: "Weekly audit", trigger: "schedule", status },
    });
    return { ...w, rule };
  }

  it("creates tasks through the same service: backlog, from automation, with history and no creator", async () => {
    const { a, rule, projectA } = await withRule();
    const result = await createTaskForAutomation({
      ruleId: rule.id,
      runId: "run-1",
      clientId: a.id,
      title: "Review last week's rankings",
      projectId: projectA.id,
      type: "seo_fix",
      dueDate: "2026-03-01",
      priority: "high",
    });
    expect(result.created).toBe(true);
    const task = await prisma().task.findUniqueOrThrow({ where: { id: result.id } });
    expect(task).toMatchObject({
      status: "backlog",
      source: "automation",
      reporterId: null,
      clientId: a.id,
      projectId: projectA.id,
      priority: "high",
    });
    expect(task.dueAt?.toISOString()).toBe("2026-03-02T04:59:59.999Z");
    const [created] = await events(task.id);
    expect(created?.actorId).toBeNull();
    expect(
      (created?.toValue as { automation: { ruleId: string; runId: string } }).automation,
    ).toEqual({ ruleId: rule.id, runId: "run-1" });
    expect(
      await prisma().auditLog.findFirst({ where: { action: "task.created", entityId: task.id } }),
    ).toMatchObject({ actorUserId: null });
  });

  it("can assign, but a task never starts further along than Assigned, whatever is passed in", async () => {
    const { a, rule, worker } = await withRule();
    const { id } = await createTaskForAutomation({
      ruleId: rule.id,
      clientId: a.id,
      title: "T",
      assigneeId: worker.userId,
      status: "completed",
    } as never);
    expect((await prisma().task.findUniqueOrThrow({ where: { id } })).status).toBe("assigned");
    expect((await notes(worker.userId, "task.assigned"))[0]?.title).toMatch(/automation/);
  });

  it("can never move, approve or complete a task, and running again does not finish anything", async () => {
    const { a, rule } = await withRule();
    const { id } = await createTaskForAutomation({ ruleId: rule.id, clientId: a.id, title: "T" });
    for (const to of ["assigned", "in_progress", "approved", "completed", "cancelled"] as const) {
      await expect(
        transitionTask({ automation: { ruleId: rule.id } }, id, { to, note: "automated" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect((await prisma().task.findUniqueOrThrow({ where: { id } })).status).toBe("backlog");
    expect((await events(id)).map((e) => e.type)).toEqual(["created"]);
  });

  it("returns the existing task when the same idempotency key is used again", async () => {
    const { a, rule } = await withRule();
    const input = {
      ruleId: rule.id,
      clientId: a.id,
      title: "Monthly report",
      idempotencyKey: "2026-03",
    };
    const first = await createTaskForAutomation(input);
    const again = await createTaskForAutomation(input);
    expect(again).toEqual({ id: first.id, created: false });
    expect(await prisma().task.count()).toBe(1);
    expect((await createTaskForAutomation({ ...input, idempotencyKey: "2026-04" })).created).toBe(
      true,
    );
  });

  it("only works inside the rule's own client, and only for active rules and clients", async () => {
    const { a, a2, b, rule, tenant } = await withRule();
    await expect(
      createTaskForAutomation({ ruleId: rule.id, clientId: a2.id, title: "T" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createTaskForAutomation({ ruleId: rule.id, clientId: b.id, title: "T" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const draft = await prisma().automationRule.create({
      data: { ...tenant(a), name: "Draft", trigger: "manual", status: "draft" },
    });
    await expect(
      createTaskForAutomation({ ruleId: draft.id, clientId: a.id, title: "T" }),
    ).rejects.toThrow(/not active/);
    await prisma().client.update({ where: { id: a.id }, data: { status: "paused" } });
    await expect(
      createTaskForAutomation({ ruleId: rule.id, clientId: a.id, title: "T" }),
    ).rejects.toThrow(/not active/);
    expect(await prisma().task.count()).toBe(0);
  });

  it("applies the same validation as a person", async () => {
    const { a, rule, projectB, reviewer } = await withRule();
    expect(
      Object.keys(
        await fieldErrors(
          createTaskForAutomation({
            ruleId: rule.id,
            clientId: a.id,
            title: "",
            dueDate: "tomorrow",
          }),
        ),
      ),
    ).toEqual(["title", "dueDate"]);
    expect(
      (
        await fieldErrors(
          createTaskForAutomation({
            ruleId: rule.id,
            clientId: a.id,
            title: "T",
            projectId: projectB.id,
          }),
        )
      ).projectId,
    ).toBeDefined();
    expect(
      (
        await fieldErrors(
          createTaskForAutomation({
            ruleId: rule.id,
            clientId: a.id,
            title: "T",
            assigneeId: reviewer.userId,
          }),
        )
      ).assigneeId,
    ).toBeDefined();
    void createTokenCipherForTests;
  });
});
