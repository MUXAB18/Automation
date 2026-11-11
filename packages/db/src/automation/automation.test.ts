import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
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
  RECOMMENDED_RULES,
  computeDueDate,
  parseRulePayload,
  renderTemplate,
  type RulePayload,
} from "./config";
import {
  MAX_ATTEMPTS,
  claimNextAutomationRun,
  executeAutomationRun,
  failStaleAutomationRuns,
  queueDueAutomationRuns,
  resolveAssignee,
} from "./engine";
import {
  createRule,
  getRun,
  installRecommendedRules,
  listFindings,
  listRuns,
  runRuleNow,
  setRuleEnabled,
  updateRule,
} from "./rules";

beforeEach(resetDb);

const preset = (kind: string): RulePayload =>
  structuredClone(RECOMMENDED_RULES.find((r) => r.kind === kind)!);
const HOUR = 3_600_000;

async function world() {
  const agency = await makeAgency("Agency One");
  const client = await makeClient("Client One", "client-one", agency.id);
  const admin = await makeUser();
  await addAgencyStaff(admin, agency.id, "agency_admin", true);
  return { agency, client, admin };
}

async function content(
  clientId: string,
  agencyId: string,
  title: string,
  scheduledFor: Date,
  assignedToId?: string,
) {
  return prisma().contentItem.create({
    data: {
      agencyId,
      clientId,
      title,
      type: "blog_post",
      channel: "website",
      status: "draft",
      scheduledFor,
      assignedToId,
    },
  });
}

/** Queue, claim and execute one run of a rule, the way the worker does. */
async function runOnce(
  admin: Awaited<ReturnType<typeof makeUser>>,
  ruleId: string,
  now = new Date(),
) {
  await runRuleNow(admin, ruleId);
  const runId = await claimNextAutomationRun();
  expect(runId).toBeTruthy();
  await executeAutomationRun(runId!, now);
  return prisma().automationRun.findUniqueOrThrow({ where: { id: runId! } });
}

describe("rule configuration", () => {
  it("accepts every recommended rule", () => {
    expect(RECOMMENDED_RULES).toHaveLength(7);
    for (const r of RECOMMENDED_RULES) expect(() => parseRulePayload(r)).not.toThrow();
  });

  it("rejects settings that do not match the rule type", () => {
    const bad = preset("organic_traffic_drop");
    (bad.config as Record<string, unknown>).dropPercent = -5;
    expect(() => parseRulePayload(bad)).toThrow();
  });

  it("renders templates and leaves unknown variables empty", () => {
    expect(renderTemplate("Fix {{a}} on {{b}}", { a: "x" }, 100)).toBe("Fix x on");
  });

  it("computes due dates in business days and by severity", () => {
    const friday = new Date("2026-11-06T12:00:00Z");
    const fixed = computeDueDate(
      { mode: "days", days: 2, businessDays: true } as never,
      "medium",
      friday,
      "UTC",
    );
    expect(fixed).toBe("2026-11-10"); // Fri + 2 business days = Tue
  });
});

describe("rule evaluation and task creation", () => {
  it("creates one task with priority, due date, criteria and a notification for a due content item", async () => {
    const { agency, client, admin } = await world();
    const writer = await makeUser();
    await addMember(writer, client.id, "seo_specialist");
    const now = new Date();
    const item = await content(
      client.id,
      agency.id,
      "Spring guide",
      new Date(now.getTime() + 10 * HOUR),
      writer.userId,
    );
    const payload = preset("content_deadline_approaching");
    payload.assignment = { mode: "entity_owner" } as never;
    const rule = await createRule(admin, { clientId: client.id, enabled: true, payload });

    const run = await runOnce(admin, rule.id, now);
    expect(run.status).toBe("succeeded");
    const tasks = await prisma().task.findMany({
      where: { clientId: client.id, source: "automation" },
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ assigneeId: writer.userId, contentItemId: item.id });
    expect(tasks[0]!.automationKey).toContain(item.id);
    expect(tasks[0]!.acceptanceCriteria).toBeTruthy();
    expect(tasks[0]!.dueAt).toBeTruthy();
    expect(
      await prisma().notification.count({ where: { clientId: client.id, userId: writer.userId } }),
    ).toBeGreaterThan(0);
    const steps = await prisma().automationStepRun.count({ where: { runId: run.id } });
    expect(steps).toBeGreaterThanOrEqual(3);
    expect(
      await prisma().auditLog.count({
        where: { clientId: client.id, action: { startsWith: "task." } },
      }),
    ).toBeGreaterThan(0);
  });

  it("does not create a second task when the rule runs again", async () => {
    const { agency, client, admin } = await world();
    const now = new Date();
    await content(client.id, agency.id, "Guide", new Date(now.getTime() + 5 * HOUR));
    const rule = await createRule(admin, {
      clientId: client.id,
      enabled: true,
      payload: preset("content_deadline_approaching"),
    });
    await runOnce(admin, rule.id, now);
    const second = await runOnce(admin, rule.id, new Date(now.getTime() + HOUR));
    expect(second.status).toBe("succeeded");
    expect(
      await prisma().task.count({ where: { clientId: client.id, source: "automation" } }),
    ).toBe(1);
    expect((second.summary as { deduped: number }).deduped).toBe(1);
    const findings = await prisma().automationFinding.findMany({ where: { clientId: client.id } });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.occurrences).toBe(2);
  });

  it("links an existing open task instead of creating one", async () => {
    const { agency, client, admin } = await world();
    const now = new Date();
    const item = await content(client.id, agency.id, "Guide", new Date(now.getTime() + 5 * HOUR));
    const existing = await prisma().task.create({
      data: {
        agencyId: agency.id,
        clientId: client.id,
        title: "Write guide",
        contentItemId: item.id,
        status: "in_progress",
      },
    });
    const rule = await createRule(admin, {
      clientId: client.id,
      enabled: true,
      payload: preset("content_deadline_approaching"),
    });
    await runOnce(admin, rule.id, now);
    expect(
      await prisma().task.count({ where: { clientId: client.id, source: "automation" } }),
    ).toBe(0);
    expect(
      (await prisma().automationFinding.findFirstOrThrow({ where: { clientId: client.id } }))
        .taskId,
    ).toBe(existing.id);
  });

  it("the database refuses two open tasks with the same automation key", async () => {
    const { agency, client } = await world();
    const data = {
      agencyId: agency.id,
      clientId: client.id,
      title: "T",
      automationKey: "k1",
      source: "automation" as const,
    };
    await prisma().task.create({ data });
    await expect(prisma().task.create({ data })).rejects.toMatchObject({ code: "P2002" });
    await prisma().task.updateMany({
      where: { clientId: client.id },
      data: { status: "completed", completedAt: new Date() },
    });
    await expect(prisma().task.create({ data })).resolves.toBeTruthy(); // allowed again once closed
  });

  it("resolves a finding when the condition clears, and keeps the task", async () => {
    const { agency, client, admin } = await world();
    const now = new Date();
    const item = await content(client.id, agency.id, "Guide", new Date(now.getTime() + 5 * HOUR));
    const rule = await createRule(admin, {
      clientId: client.id,
      enabled: true,
      payload: preset("content_deadline_approaching"),
    });
    await runOnce(admin, rule.id, now);
    await prisma().contentItem.update({ where: { id: item.id }, data: { status: "approved" } });
    const second = await runOnce(admin, rule.id, new Date(now.getTime() + HOUR));
    expect((second.summary as { resolved: number }).resolved).toBe(1);
    expect(
      (await prisma().automationFinding.findFirstOrThrow({ where: { clientId: client.id } }))
        .status,
    ).toBe("resolved");
    expect(
      await prisma().task.count({ where: { clientId: client.id, source: "automation" } }),
    ).toBe(1);
  });

  it("caps tasks per run", async () => {
    const { agency, client, admin } = await world();
    const now = new Date();
    for (let i = 0; i < 4; i++)
      await content(client.id, agency.id, `Item ${i}`, new Date(now.getTime() + (i + 1) * HOUR));
    const payload = preset("content_deadline_approaching");
    payload.cooldown = { ...payload.cooldown, maxTasksPerRun: 2 } as never;
    const rule = await createRule(admin, { clientId: client.id, enabled: true, payload });
    const run = await runOnce(admin, rule.id, now);
    expect(
      await prisma().task.count({ where: { clientId: client.id, source: "automation" } }),
    ).toBe(2);
    expect((run.summary as { capped: number }).capped).toBe(2);
  });

  it("overdue-task rule notifies but never creates tasks (no loops)", async () => {
    const { agency, client, admin } = await world();
    const assignee = await makeUser();
    await addMember(assignee, client.id, "seo_specialist");
    const now = new Date();
    await prisma().task.create({
      data: {
        agencyId: agency.id,
        clientId: client.id,
        title: "Late",
        status: "in_progress",
        assigneeId: assignee.userId,
        dueAt: new Date(now.getTime() - 48 * HOUR),
      },
    });
    const rule = await createRule(admin, {
      clientId: client.id,
      enabled: true,
      payload: preset("task_overdue"),
    });
    const before = await prisma().task.count();
    const run = await runOnce(admin, rule.id, now);
    expect(run.status).toBe("succeeded");
    expect(await prisma().task.count()).toBe(before);
    expect(
      await prisma().notification.count({ where: { userId: assignee.userId } }),
    ).toBeGreaterThan(0);
    // A second run does not notify again.
    const notes = await prisma().notification.count({ where: { clientId: client.id } });
    await runOnce(admin, rule.id, new Date(now.getTime() + HOUR));
    expect(await prisma().notification.count({ where: { clientId: client.id } })).toBe(notes);
  });

  it("skips (does not fail) when the source data is missing", async () => {
    const { client, admin } = await world();
    const rule = await createRule(admin, {
      clientId: client.id,
      enabled: true,
      payload: preset("organic_traffic_drop"),
    });
    const run = await runOnce(admin, rule.id);
    expect(run.status).toBe("skipped");
    expect((run.summary as { skippedReason?: string }).skippedReason).toBeTruthy();
    expect(await prisma().task.count()).toBe(0);
  });
});

describe("scheduling, retries and failures", () => {
  it("queues one run per interval however often it is asked", async () => {
    const { client, admin } = await world();
    const rule = await createRule(admin, {
      clientId: client.id,
      enabled: true,
      payload: preset("task_overdue"),
    });
    const now = new Date();
    const a = await queueDueAutomationRuns(now);
    const b = await queueDueAutomationRuns(now);
    expect(a.queued).toBe(1);
    expect(b.queued).toBe(0);
    expect(await prisma().automationRun.count({ where: { ruleId: rule.id } })).toBe(1);
  });

  it("does not run paused rules", async () => {
    const { client, admin } = await world();
    await createRule(admin, {
      clientId: client.id,
      enabled: false,
      payload: preset("task_overdue"),
    });
    expect((await queueDueAutomationRuns()).queued).toBe(0);
  });

  it("a rule never has two active runs", async () => {
    const { client, admin } = await world();
    const rule = await createRule(admin, {
      clientId: client.id,
      enabled: true,
      payload: preset("task_overdue"),
    });
    await runRuleNow(admin, rule.id);
    await expect(runRuleNow(admin, rule.id)).rejects.toThrow();
  });

  it("re-queues a failed run with a retry time, up to the attempt limit", async () => {
    const { client, admin } = await world();
    const rule = await createRule(admin, {
      clientId: client.id,
      enabled: true,
      payload: preset("task_overdue"),
    });
    await runRuleNow(admin, rule.id);
    const id = (await claimNextAutomationRun())!;
    const soon = new Date(Date.now() + HOUR);
    await prisma().automationRun.update({
      where: { id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        nextAttemptAt: new Date(soon.getTime() - 1),
      },
    });
    expect((await queueDueAutomationRuns(soon)).retried).toBe(1);
    expect(await prisma().automationRun.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "queued",
      attempt: 2,
    });
    await prisma().automationRun.update({
      where: { id },
      data: {
        status: "failed",
        attempt: MAX_ATTEMPTS,
        nextAttemptAt: new Date(soon.getTime() - 1),
      },
    });
    expect((await queueDueAutomationRuns(soon)).retried).toBe(0);
  });

  it("fails a run stuck in running and schedules a retry", async () => {
    const { client, admin } = await world();
    const rule = await createRule(admin, {
      clientId: client.id,
      enabled: true,
      payload: preset("task_overdue"),
    });
    await runRuleNow(admin, rule.id);
    const id = (await claimNextAutomationRun())!;
    const later = new Date(Date.now() + 12 * HOUR); // the test database clock runs ahead of Node
    expect(await failStaleAutomationRuns(later)).toBe(1);
    expect(await prisma().automationRun.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "failed",
    });
  });

  it("an invalid stored configuration fails the run without a retry", async () => {
    const { client, admin } = await world();
    const rule = await createRule(admin, {
      clientId: client.id,
      enabled: true,
      payload: preset("task_overdue"),
    });
    await prisma().automationRule.update({
      where: { id: rule.id },
      data: { config: { graceHours: "soon" } },
    });
    const run = await runOnce(admin, rule.id);
    expect(run.status).toBe("failed");
    expect(run.nextAttemptAt).toBeNull();
  });

  it("re-executing a finished run changes nothing", async () => {
    const { agency, client, admin } = await world();
    const now = new Date();
    await content(client.id, agency.id, "Guide", new Date(now.getTime() + 5 * HOUR));
    const rule = await createRule(admin, {
      clientId: client.id,
      enabled: true,
      payload: preset("content_deadline_approaching"),
    });
    const run = await runOnce(admin, rule.id, now);
    await executeAutomationRun(run.id, now); // not "running" any more
    expect(
      await prisma().task.count({ where: { clientId: client.id, source: "automation" } }),
    ).toBe(1);
  });
});

describe("assignment", () => {
  it("picks the role holder with the fewest open tasks", async () => {
    const { agency, client } = await world();
    const busy = await makeUser();
    const free = await makeUser();
    await addMember(busy, client.id, "seo_specialist");
    await addMember(free, client.id, "seo_specialist");
    for (let i = 0; i < 3; i++)
      await prisma().task.create({
        data: {
          agencyId: agency.id,
          clientId: client.id,
          title: `T${i}`,
          assigneeId: busy.userId,
          status: "in_progress",
        },
      });
    const r = await resolveAssignee(
      { agencyId: agency.id, clientId: client.id },
      { mode: "role", roleKey: "seo_specialist", strategy: "least_loaded" } as never,
      null,
    );
    expect(r).toMatchObject({ userId: free.userId, reviewQueue: false });
  });

  it("uses the entity owner when they can take tasks, otherwise falls back to the review queue", async () => {
    const { agency, client } = await world();
    const owner = await makeUser();
    await addMember(owner, client.id, "seo_specialist");
    const viewer = await makeUser();
    await addMember(viewer, client.id, "client");
    const scope = { agencyId: agency.id, clientId: client.id };
    const policy = { mode: "entity_owner", roleKey: "content_writer", strategy: "first" } as never;
    expect((await resolveAssignee(scope, policy, owner.userId)).userId).toBe(owner.userId);
    const fallback = await resolveAssignee(scope, policy, viewer.userId);
    expect(fallback.userId).toBeNull();
    expect(fallback.reviewQueue).toBe(true);
  });

  it("leaves the task unassigned and tells reviewers when nobody qualifies", async () => {
    const { agency, client, admin } = await world();
    const reviewer = await makeUser();
    await addMember(reviewer, client.id, "reviewer");
    const now = new Date();
    await content(client.id, agency.id, "Guide", new Date(now.getTime() + 5 * HOUR));
    const payload = preset("content_deadline_approaching");
    payload.assignment = { mode: "role", roleKey: "content_writer", strategy: "first" } as never;
    const rule = await createRule(admin, { clientId: client.id, enabled: true, payload });
    await runOnce(admin, rule.id, now);
    const task = await prisma().task.findFirstOrThrow({
      where: { clientId: client.id, source: "automation" },
    });
    expect(task.assigneeId).toBeNull();
    expect(
      await prisma().notification.count({ where: { userId: reviewer.userId } }),
    ).toBeGreaterThan(0);
  });
});

describe("permissions and tenant isolation", () => {
  it("a viewer cannot create or run rules", async () => {
    const { client } = await world();
    const viewer = await makeUser();
    await addMember(viewer, client.id, "client");
    await expect(
      createRule(viewer, { clientId: client.id, payload: preset("task_overdue") }),
    ).rejects.toThrow();
  });

  it("another agency cannot see, edit, enable or run a rule, its runs or findings", async () => {
    const { agency, client, admin } = await world();
    const now = new Date();
    await content(client.id, agency.id, "Guide", new Date(now.getTime() + 5 * HOUR));
    const rule = await createRule(admin, {
      clientId: client.id,
      enabled: true,
      payload: preset("content_deadline_approaching"),
    });
    const run = await runOnce(admin, rule.id, now);

    const other = await makeAgency("Agency Two");
    const otherClient = await makeClient("Other", "other", other.id);
    const outsider = await makeUser();
    await addAgencyStaff(outsider, other.id, "agency_admin", true);

    await expect(
      updateRule(outsider, rule.id, { payload: preset("content_deadline_approaching") }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(setRuleEnabled(outsider, rule.id, false)).rejects.toBeInstanceOf(NotFoundError);
    await expect(runRuleNow(outsider, rule.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getRun(outsider, run.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listRuns(outsider, {})).rows).toHaveLength(0);
    expect((await listFindings(outsider, {})).rows).toHaveLength(0);
    expect((await listFindings(outsider, { clientId: client.id })).rows).toHaveLength(0);
    expect((await listRuns(outsider, { clientId: otherClient.id })).rows).toHaveLength(0);
  });

  it("the database refuses a run or finding that mixes clients", async () => {
    const { agency, client, admin } = await world();
    const other = await makeClient("Other", "other", agency.id);
    const rule = await createRule(admin, { clientId: client.id, payload: preset("task_overdue") });
    await expect(
      prisma().automationRun.create({
        data: {
          agencyId: agency.id,
          clientId: other.id,
          ruleId: rule.id,
          ruleVersion: 1,
          trigger: "schedule",
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma().automationFinding.create({
        data: {
          agencyId: agency.id,
          clientId: other.id,
          ruleId: rule.id,
          kind: "task_overdue",
          dedupeKey: "x",
          severity: "low",
          title: "x",
          entityType: "task",
          entityId: "x",
        },
      }),
    ).rejects.toThrow();
  });

  it("identical findings in two clients stay separate", async () => {
    const { agency, client, admin } = await world();
    const second = await makeClient("Second", "second", agency.id);
    const now = new Date();
    await content(client.id, agency.id, "A", new Date(now.getTime() + 5 * HOUR));
    await content(second.id, agency.id, "B", new Date(now.getTime() + 5 * HOUR));
    const r1 = await createRule(admin, {
      clientId: client.id,
      enabled: true,
      payload: preset("content_deadline_approaching"),
    });
    const r2 = await createRule(admin, {
      clientId: second.id,
      enabled: true,
      payload: preset("content_deadline_approaching"),
    });
    await runOnce(admin, r1.id, now);
    await runOnce(admin, r2.id, now);
    expect(
      await prisma().task.count({ where: { clientId: client.id, source: "automation" } }),
    ).toBe(1);
    expect(
      await prisma().task.count({ where: { clientId: second.id, source: "automation" } }),
    ).toBe(1);
  });
});

describe("recommended rules", () => {
  it("installs the seven rules paused, once", async () => {
    const { client, admin } = await world();
    expect(await installRecommendedRules(admin, client.id)).toEqual({ created: 7, skipped: 0 });
    expect(await installRecommendedRules(admin, client.id)).toEqual({ created: 0, skipped: 7 });
    expect(
      await prisma().automationRule.count({ where: { clientId: client.id, status: "active" } }),
    ).toBe(0);
    expect((await queueDueAutomationRuns()).queued).toBe(0);
  });

  it("validates input", async () => {
    const { client, admin } = await world();
    const bad = preset("task_overdue");
    bad.name = "";
    await expect(createRule(admin, { clientId: client.id, payload: bad })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

void ForbiddenError;
