import { z } from "zod";
import {
  getClientContext,
  listUsersWithPermission,
  requirePermission,
  resolveUserAccess,
  type Actor,
  type ClientContext,
} from "../access";
import { recordAudit } from "../audit";
import { endOfDayInTimeZone } from "../dates";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { Prisma } from "../generated/client";
import { PRIORITIES_LIST, TASK_TYPES_LIST } from "../task-enums";
import { parseInput } from "../schemas";
import { getUnscopedPrisma } from "../unsafe";
import {
  STATUS_LABELS,
  canTransition,
  hasCapability,
  isClosed,
  transitionRule,
  type TaskStatusName,
} from "./task-rules";

/**
 * Task commands. This is the ONLY place tasks are created or changed, whether the request comes from a
 * person in the dashboard or from an automation rule, so the rules (permissions, workflow, history,
 * notifications) cannot differ between them.
 *
 * Every command: authorises first, validates, changes data and writes the task history (task_events),
 * the audit log and notifications in ONE transaction.
 */

type Tx = Prisma.TransactionClient;
const prismaClient = () => getUnscopedPrisma();

// ---- Validation ----------------------------------------------------------------------------------

const optionalText = (max: number, what: string) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(max, `${what} must be under ${max} characters`).optional(),
  );

const optionalId = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().min(1).optional(),
);

const dueDate = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.iso.date("Use the format YYYY-MM-DD").optional(),
);

const labels = z
  .preprocess(
    (v) => (typeof v === "string" ? v.split(/[\n,]/) : v),
    z.array(z.string().trim().min(1).max(30)).max(10, "At most 10 labels"),
  )
  .default([]);

const taskFields = {
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(200, "Title must be under 200 characters"),
  description: optionalText(10000, "Description"),
  acceptanceCriteria: optionalText(4000, "Acceptance criteria"),
  type: z.enum(TASK_TYPES_LIST).default("general"),
  priority: z.enum(PRIORITIES_LIST).default("medium"),
  projectId: optionalId,
  dueDate,
  estimateMinutes: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.coerce
      .number()
      .int("Use whole minutes")
      .min(1, "At least 1 minute")
      .max(60_000, "That is more than 1,000 hours")
      .optional(),
  ),
  assigneeId: optionalId,
  contentItemId: optionalId,
  seoIssueIds: z
    .preprocess(
      (v) => (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : []),
      z.array(z.string().min(1)).max(20),
    )
    .default([]),
  labels,
};

export const createTaskSchema = z.object({ clientId: z.string().min(1), ...taskFields });
export const updateTaskSchema = z.object(taskFields).omit({ assigneeId: true });
export type CreateTaskInput = z.input<typeof createTaskSchema>;
export type UpdateTaskInput = z.input<typeof updateTaskSchema>;

const evidenceSchema = z.object({
  note: optionalText(4000, "The evidence note"),
  links: z
    .preprocess(
      (v) => (typeof v === "string" ? v.split(/[\n,\s]+/) : v),
      z.array(z.string().trim().min(1)).max(10, "At most 10 links"),
    )
    .pipe(
      z.array(
        z
          .url("Enter full web addresses, e.g. https://…")
          .refine((u) => /^https?:\/\//i.test(u), "Only http and https links are allowed"),
      ),
    )
    .default([]),
});

export type TransitionInput = {
  to: TaskStatusName;
  /** Why (required for blocked, changes requested and cancelled). */
  note?: string;
  /** Proof of the finished work (required to submit for review unless something is attached). */
  evidence?: { note?: string; links?: string[] | string };
};

// ---- Who is acting -------------------------------------------------------------------------------

/** A person, or an automation rule acting on its own. Automation may create tasks and nothing more. */
export type AutomationActor = { automation: { ruleId: string; runId?: string } };
export const isAutomation = (a: Actor | AutomationActor): a is AutomationActor => "automation" in a;

// ---- Helpers --------------------------------------------------------------------------------------

type TaskRow = Awaited<ReturnType<typeof loadRow>>;

async function loadRow(tx: Tx, taskId: string, clientId: string) {
  const task = await tx.task.findFirst({
    where: { id: taskId, clientId },
    include: { client: { select: { timezone: true, name: true } } },
  });
  if (!task) throw new NotFoundError("Task not found");
  return task;
}

/** Find the task, prove the actor can see it (404 otherwise), and return their access on its client. */
async function authorizeTask(
  actor: Actor,
  taskId: string,
): Promise<{ ctx: ClientContext; clientId: string }> {
  const found = await prismaClient().task.findUnique({
    where: { id: taskId },
    select: { clientId: true },
  });
  if (!found) throw new NotFoundError("Task not found");
  const ctx = await getClientContext(actor, found.clientId); // NotFound (and audited) when no access
  if (!ctx.access.permissions.has("task.view")) throw new NotFoundError("Task not found");
  return { ctx, clientId: found.clientId };
}

const actorFacts = (
  actor: Actor,
  ctx: ClientContext,
  task: { assigneeId: string | null; reporterId: string | null },
) => ({
  userId: actor.userId,
  permissions: ctx.access.permissions,
  assigneeId: task.assigneeId,
  reporterId: task.reporterId,
});

function event(
  tx: Tx,
  ctx: { agencyId: string; clientId: string },
  taskId: string,
  actorId: string | null,
  type: Prisma.TaskEventUncheckedCreateInput["type"],
  fromValue?: Prisma.InputJsonValue | null,
  toValue?: Prisma.InputJsonValue | null,
) {
  return tx.taskEvent.create({
    data: {
      agencyId: ctx.agencyId,
      clientId: ctx.clientId,
      taskId,
      actorId,
      type,
      fromValue: fromValue === null ? Prisma.JsonNull : (fromValue ?? undefined),
      toValue: toValue === null ? Prisma.JsonNull : (toValue ?? undefined),
    },
  });
}

/** In-app notifications for a task change. The person who made the change is never notified. */
async function notify(
  tx: Tx,
  ctx: { agencyId: string; clientId: string },
  task: { id: string; title: string },
  recipients: (string | null | undefined)[],
  exclude: string | null,
  n: { type: string; title: string; body?: string },
) {
  const ids = [...new Set(recipients.filter((r): r is string => Boolean(r) && r !== exclude))];
  if (ids.length === 0) return;
  await tx.notification.createMany({
    data: ids.map((userId) => ({
      agencyId: ctx.agencyId,
      clientId: ctx.clientId,
      userId,
      type: n.type,
      title: n.title,
      body: n.body ?? task.title,
      entityType: "task",
      entityId: task.id,
      data: { taskId: task.id },
    })),
  });
}

/** Can this person actually do the work? They must hold task.manage on the client. */
async function assertAssignable(ctx: { agencyId: string; clientId: string }, userId: string) {
  const access = await resolveUserAccess(userId, ctx.clientId, ctx.agencyId);
  if (!access?.permissions.has("task.manage")) {
    throw new ValidationError({
      assigneeId: ["Choose someone who works on this client and can do tasks"],
    });
  }
}

async function assertProject(tx: Tx, clientId: string, projectId: string | undefined) {
  if (!projectId) return;
  const project = await tx.project.findFirst({
    where: { id: projectId, clientId },
    select: { archivedAt: true },
  });
  if (!project) throw new ValidationError({ projectId: ["Choose one of this client's projects"] });
  if (project.archivedAt) throw new ValidationError({ projectId: ["That project is archived"] });
}

async function assertContentItem(tx: Tx, clientId: string, id: string | undefined) {
  if (!id) return;
  if (!(await tx.contentItem.findFirst({ where: { id, clientId }, select: { id: true } }))) {
    throw new ValidationError({ contentItemId: ["Choose content that belongs to this client"] });
  }
}

async function linkIssues(tx: Tx, clientId: string, taskId: string, issueIds: string[]) {
  const issues = await tx.seoIssue.findMany({
    where: { id: { in: issueIds }, clientId },
    select: { id: true, taskId: true },
  });
  if (issues.length !== new Set(issueIds).size)
    throw new ValidationError({ seoIssueIds: ["Choose issues that belong to this client"] });
  if (issues.some((i) => i.taskId && i.taskId !== taskId)) {
    throw new ValidationError({
      seoIssueIds: ["One of those issues is already tracked by another task"],
    });
  }
  await tx.seoIssue.updateMany({ where: { id: { in: issueIds }, clientId }, data: { taskId } });
}

// ---- Create ----------------------------------------------------------------------------------------

type Origin =
  { kind: "user"; actor: Actor } | { kind: "automation"; ruleId: string; runId?: string };

/** The one place a task row is created. */
async function insertTask(
  tx: Tx,
  ctx: { agencyId: string; clientId: string; timezone: string },
  data: z.output<typeof createTaskSchema>,
  origin: Origin,
) {
  await assertProject(tx, ctx.clientId, data.projectId);
  await assertContentItem(tx, ctx.clientId, data.contentItemId);
  const userId = origin.kind === "user" ? origin.actor.userId : null;
  const task = await tx.task.create({
    data: {
      agencyId: ctx.agencyId,
      clientId: ctx.clientId,
      projectId: data.projectId ?? null,
      title: data.title,
      description: data.description ?? null,
      acceptanceCriteria: data.acceptanceCriteria ?? null,
      type: data.type,
      priority: data.priority,
      source:
        origin.kind === "automation"
          ? "automation"
          : data.seoIssueIds.length
            ? "seo_issue"
            : "manual",
      // A task starts in the backlog; having an assignee makes it "assigned". Nothing starts further along.
      status: data.assigneeId ? "assigned" : "backlog",
      assigneeId: data.assigneeId ?? null,
      reporterId: userId,
      labels: data.labels,
      estimateMinutes: data.estimateMinutes ?? null,
      dueAt: data.dueDate ? endOfDayInTimeZone(data.dueDate, ctx.timezone) : null,
      contentItemId: data.contentItemId ?? null,
    },
  });
  if (data.seoIssueIds.length) await linkIssues(tx, ctx.clientId, task.id, data.seoIssueIds);
  await event(tx, ctx, task.id, userId, "created", undefined, {
    title: task.title,
    status: task.status,
    assigneeId: task.assigneeId,
    ...(origin.kind === "automation"
      ? { automation: { ruleId: origin.ruleId, runId: origin.runId ?? null } }
      : {}),
  });
  await recordAudit(tx, {
    actorUserId: userId,
    agencyId: ctx.agencyId,
    clientId: ctx.clientId,
    action: "task.created",
    entityType: "task",
    entityId: task.id,
    after: {
      title: task.title,
      status: task.status,
      assigneeId: task.assigneeId,
      source: task.source,
    },
  });
  await notify(tx, ctx, task, [task.assigneeId], userId, {
    type: "task.assigned",
    title:
      origin.kind === "automation" ? "New task from an automation" : "A task was assigned to you",
  });
  return task;
}

export async function createTask(actor: Actor, input: CreateTaskInput) {
  const data = parseInput(createTaskSchema, input);
  const ctx = await requirePermission(actor, data.clientId, "task.manage");
  // Assigning someone else needs task.assign; anyone who can do tasks may take one for themselves.
  if (
    data.assigneeId &&
    data.assigneeId !== actor.userId &&
    !ctx.access.permissions.has("task.assign")
  ) {
    throw new ForbiddenError("You cannot assign tasks to other people");
  }
  if (data.assigneeId) await assertAssignable(ctx, data.assigneeId);
  const client = await prismaClient().client.findUniqueOrThrow({
    where: { id: data.clientId },
    select: { timezone: true, status: true },
  });
  if (client.status === "archived") throw new ConflictError("This client is archived");
  return prismaClient().$transaction((tx) =>
    insertTask(
      tx,
      { agencyId: ctx.agencyId, clientId: ctx.clientId, timezone: client.timezone },
      data,
      { kind: "user", actor },
    ),
  );
}

export const automationTaskSchema = createTaskSchema.omit({ assigneeId: true }).extend({
  ruleId: z.string().min(1),
  runId: optionalId,
  assigneeId: optionalId,
  /** Repeating the same key returns the task already created instead of making a duplicate. */
  idempotencyKey: z.string().min(1).max(200).optional(),
});
export type AutomationTaskInput = z.input<typeof automationTaskSchema>;

/**
 * Create a task on behalf of an automation rule, using exactly the same rules as a person creating one.
 * An automation can only ever put work INTO the backlog (or assign it); it can never move a task
 * forward, review it or complete it - finishing work is a human decision, however the task began.
 */
export async function createTaskForAutomation(
  input: AutomationTaskInput,
): Promise<{ id: string; created: boolean }> {
  const data = parseInput(automationTaskSchema, input);
  const prisma = prismaClient();
  const rule = await prisma.automationRule.findFirst({
    where: { id: data.ruleId, clientId: data.clientId },
    select: { status: true, client: { select: { agencyId: true, timezone: true, status: true } } },
  });
  // A rule can only act inside its own client.
  if (!rule) throw new NotFoundError("Automation rule not found");
  if (rule.status !== "active") throw new ConflictError("This automation rule is not active");
  if (rule.client.status !== "active") throw new ConflictError("This client is not active");
  const ctx = {
    agencyId: rule.client.agencyId,
    clientId: data.clientId,
    timezone: rule.client.timezone,
  };
  if (data.assigneeId) await assertAssignable(ctx, data.assigneeId);

  const { ruleId, runId, idempotencyKey, ...fields } = data;
  return prisma.$transaction(async (tx) => {
    if (idempotencyKey) {
      const key = {
        agencyId: ctx.agencyId,
        scope: `task.automation.${ruleId}`,
        key: idempotencyKey,
      };
      const existing = await tx.idempotencyKey.findUnique({ where: { agencyId_scope_key: key } });
      const previous = (existing?.response as { taskId?: string } | null)?.taskId;
      if (previous) return { id: previous, created: false };
    }
    const task = await insertTask(
      tx,
      ctx,
      { ...fields, seoIssueIds: fields.seoIssueIds },
      { kind: "automation", ruleId, runId },
    );
    if (idempotencyKey) {
      await tx.idempotencyKey.create({
        data: {
          agencyId: ctx.agencyId,
          clientId: ctx.clientId,
          scope: `task.automation.${ruleId}`,
          key: idempotencyKey,
          response: { taskId: task.id },
          completedAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
    }
    return { id: task.id, created: true };
  });
}

// ---- Edit ------------------------------------------------------------------------------------------

function canEdit(
  ctx: ClientContext,
  actor: Actor,
  task: { assigneeId: string | null; reporterId: string | null },
) {
  const p = ctx.access.permissions;
  return (
    p.has("task.assign") ||
    (p.has("task.manage") && (task.assigneeId === actor.userId || task.reporterId === actor.userId))
  );
}

export async function updateTask(actor: Actor, taskId: string, input: UpdateTaskInput) {
  const data = parseInput(updateTaskSchema, input);
  const { ctx, clientId } = await authorizeTask(actor, taskId);
  return prismaClient().$transaction(async (tx) => {
    const before = await loadRow(tx, taskId, clientId);
    if (!canEdit(ctx, actor, before)) throw new ForbiddenError("You cannot edit this task");
    if (isClosed(before.status))
      throw new ConflictError(
        `A ${STATUS_LABELS[before.status].toLowerCase()} task cannot be edited`,
      );
    await assertProject(tx, clientId, data.projectId);
    await assertContentItem(tx, clientId, data.contentItemId);

    const dueAt = data.dueDate ? endOfDayInTimeZone(data.dueDate, before.client.timezone) : null;
    const after = await tx.task.update({
      where: { id: taskId },
      data: {
        title: data.title,
        description: data.description ?? null,
        acceptanceCriteria: data.acceptanceCriteria ?? null,
        type: data.type,
        priority: data.priority,
        projectId: data.projectId ?? null,
        estimateMinutes: data.estimateMinutes ?? null,
        labels: data.labels,
        dueAt,
        contentItemId: data.contentItemId ?? null,
      },
    });
    // Issues linked to this task become exactly the selected set.
    await tx.seoIssue.updateMany({
      where: { taskId, clientId, id: { notIn: data.seoIssueIds } },
      data: { taskId: null },
    });
    if (data.seoIssueIds.length) await linkIssues(tx, clientId, taskId, data.seoIssueIds);

    const base = { agencyId: ctx.agencyId, clientId };
    const changed: Record<string, [unknown, unknown]> = {};
    for (const k of [
      "title",
      "description",
      "acceptanceCriteria",
      "type",
      "projectId",
      "estimateMinutes",
    ] as const) {
      if (before[k] !== after[k]) changed[k] = [before[k], after[k]];
    }
    if (before.labels.join("|") !== after.labels.join("|"))
      changed.labels = [before.labels, after.labels];
    if (Object.keys(changed).length) {
      await event(
        tx,
        base,
        taskId,
        actor.userId,
        "updated",
        Object.fromEntries(
          Object.entries(changed).map(([k, v]) => [k, v[0]]),
        ) as Prisma.InputJsonValue,
        Object.fromEntries(
          Object.entries(changed).map(([k, v]) => [k, v[1]]),
        ) as Prisma.InputJsonValue,
      );
    }
    if (before.priority !== after.priority)
      await event(
        tx,
        base,
        taskId,
        actor.userId,
        "priority_changed",
        before.priority,
        after.priority,
      );
    if (before.dueAt?.getTime() !== after.dueAt?.getTime()) {
      await event(
        tx,
        base,
        taskId,
        actor.userId,
        "due_date_changed",
        before.dueAt?.toISOString() ?? null,
        after.dueAt?.toISOString() ?? null,
      );
      await notify(tx, base, after, [after.assigneeId], actor.userId, {
        type: "task.due_changed",
        title: "A task's due date changed",
      });
    }
    if (before.priority !== after.priority) {
      await notify(tx, base, after, [after.assigneeId], actor.userId, {
        type: "task.priority_changed",
        title: `A task is now ${after.priority} priority`,
      });
    }
    if (before.contentItemId !== after.contentItemId)
      await event(
        tx,
        base,
        taskId,
        actor.userId,
        "linked",
        before.contentItemId,
        after.contentItemId,
      );
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId,
      action: "task.updated",
      entityType: "task",
      entityId: taskId,
      before: { title: before.title, priority: before.priority },
      after: { title: after.title, priority: after.priority },
    });
    return after;
  });
}

// ---- Assignment -------------------------------------------------------------------------------------

/**
 * Assign, reassign or unassign. Managers (task.assign) can do any of these; anyone who can do tasks may
 * take an unassigned one for themselves. Assigning moves a backlog task to "Assigned"; unassigning moves
 * an assigned task back to the backlog; reassigning an in-progress task hands it over as "Assigned".
 */
export async function assignTask(actor: Actor, taskId: string, assigneeId: string | null) {
  const { ctx, clientId } = await authorizeTask(actor, taskId);
  const base = { agencyId: ctx.agencyId, clientId };
  const p = ctx.access.permissions;
  if (assigneeId) await assertAssignable(ctx, assigneeId);

  return prismaClient().$transaction(async (tx) => {
    const before = await loadRow(tx, taskId, clientId);
    if (isClosed(before.status))
      throw new ConflictError(
        `A ${STATUS_LABELS[before.status].toLowerCase()} task cannot be reassigned`,
      );
    const claiming =
      assigneeId === actor.userId && before.assigneeId === null && p.has("task.manage");
    if (!p.has("task.assign") && !claiming) throw new ForbiddenError("You cannot assign this task");
    if (before.assigneeId === assigneeId) return before;

    let status = before.status as TaskStatusName;
    if (assigneeId === null && status === "assigned") status = "backlog";
    else if (assigneeId !== null && status === "backlog") status = "assigned";
    else if (assigneeId !== null && before.assigneeId !== null && status === "in_progress")
      status = "assigned";

    const moved = await tx.task.updateMany({
      where: { id: taskId, assigneeId: before.assigneeId, status: before.status },
      data: { assigneeId, status },
    });
    if (moved.count !== 1)
      throw new ConflictError("This task was just changed by someone else. Reload and try again");
    const after = await loadRow(tx, taskId, clientId);

    const type =
      assigneeId === null ? "unassigned" : before.assigneeId === null ? "assigned" : "reassigned";
    await event(tx, base, taskId, actor.userId, type, before.assigneeId, assigneeId);
    if (status !== before.status)
      await event(tx, base, taskId, actor.userId, "status_changed", before.status, status);
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId,
      action: `task.${type}`,
      entityType: "task",
      entityId: taskId,
      before: { assigneeId: before.assigneeId, status: before.status },
      after: { assigneeId, status },
    });
    await notify(tx, base, after, [assigneeId], actor.userId, {
      type: "task.assigned",
      title: "A task was assigned to you",
    });
    await notify(tx, base, after, [before.assigneeId], actor.userId, {
      type: "task.unassigned",
      title: "A task was taken off you",
    });
    return after;
  });
}

// ---- Workflow ----------------------------------------------------------------------------------------

const noteSchema = z.string().trim().min(3, "Say why, in a few words").max(2000);

/**
 * Move a task along its workflow. Checks, in order: the move exists in the workflow, the person is allowed
 * to make it, the move's own requirements (a reason, or evidence for review), dependencies, and that nobody
 * else changed the task in the meantime. Every successful move is recorded in the task history.
 */
export async function transitionTask(
  actor: Actor | AutomationActor,
  taskId: string,
  input: TransitionInput,
) {
  // Finishing work is a human decision: an automation run never moves a task.
  if (isAutomation(actor)) throw new ForbiddenError("Automation cannot change a task's status");
  const { ctx, clientId } = await authorizeTask(actor, taskId);
  const base = { agencyId: ctx.agencyId, clientId };

  return prismaClient().$transaction(async (tx) => {
    const task = await loadRow(tx, taskId, clientId);
    const from = task.status as TaskStatusName;
    const to = input.to;
    if (!canTransition(from, to)) {
      throw new ConflictError(
        `A task that is "${STATUS_LABELS[from]}" cannot move to "${STATUS_LABELS[to]}"`,
      );
    }
    const rule = transitionRule(from, to)!;
    if (!hasCapability(rule.capability, actorFacts(actor, ctx, task))) {
      throw new ForbiddenError(
        rule.capability === "review" && task.assigneeId === actor.userId
          ? "You cannot review your own work"
          : `You are not allowed to ${rule.label.toLowerCase()}`,
      );
    }

    // --- the move's own requirements
    let note: string | undefined;
    if (rule.needs === "note") {
      const parsed = noteSchema.safeParse(input.note);
      if (!parsed.success)
        throw new ValidationError({
          note: [parsed.error.issues[0]?.message ?? "A reason is required"],
        });
      note = parsed.data;
    } else if (input.note?.trim()) {
      note = noteSchema.parse(input.note);
    }
    if (to === "assigned" && from === "backlog" && !task.assigneeId)
      throw new ValidationError({ assigneeId: ["Assign someone first"] });

    let evidence: z.output<typeof evidenceSchema> | undefined;
    if (rule.needs === "evidence") {
      evidence = parseInput(evidenceSchema, {
        note: input.evidence?.note,
        links: input.evidence?.links ?? [],
      });
      const attachments = await tx.taskAttachment.count({ where: { taskId, deletedAt: null } });
      if (!evidence.note && evidence.links.length === 0 && attachments === 0) {
        throw new ValidationError({
          evidenceNote: [
            "Describe or link what was done, or attach a file, so the reviewer can check it",
          ],
        });
      }
    }

    // --- dependencies
    if (
      (to === "in_progress" &&
        from !== "blocked" &&
        from !== "changes_requested" &&
        from !== "ready_for_review") ||
      to === "completed"
    ) {
      const waiting = await tx.taskDependency.findMany({
        where: { taskId, dependsOnTask: { status: { notIn: ["completed", "cancelled"] } } },
        select: { dependsOnTask: { select: { title: true } } },
      });
      if (waiting.length) {
        throw new ConflictError(
          `Waiting for: ${waiting.map((w) => `"${w.dependsOnTask.title}"`).join(", ")}`,
        );
      }
    }

    // --- apply (only if nobody changed the status since we read it)
    const now = new Date();
    const data: Prisma.TaskUncheckedUpdateManyInput = { status: to };
    if (to === "in_progress") data.startedAt = task.startedAt ?? now;
    if (to === "completed") data.completedAt = now;
    if (to === "ready_for_review") {
      data.reviewRequestedAt = now;
      data.evidenceNote = evidence!.note ?? task.evidenceNote;
      data.evidenceLinks = evidence!.links.length ? evidence!.links : task.evidenceLinks;
    }
    if (from === "ready_for_review" && to !== "approved") data.reviewRequestedAt = null;
    if (from === "cancelled" && to === "backlog") data.assigneeId = null;
    if (from === "assigned" && to === "backlog") data.assigneeId = null;
    const moved = await tx.task.updateMany({ where: { id: taskId, status: from }, data });
    if (moved.count !== 1)
      throw new ConflictError("This task was just changed by someone else. Reload and try again");

    await event(
      tx,
      base,
      taskId,
      actor.userId,
      "status_changed",
      from,
      note ? { status: to, note } : { status: to },
    );
    if (evidence) {
      await event(tx, base, taskId, actor.userId, "evidence_submitted", undefined, {
        note: evidence.note ?? null,
        links: evidence.links,
      });
    }
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId,
      action: "task.status_changed",
      entityType: "task",
      entityId: taskId,
      before: { status: from },
      after: { status: to, ...(note ? { note } : {}) },
    });

    // --- who needs to know
    const after = await loadRow(tx, taskId, clientId);
    const reviewers =
      to === "ready_for_review"
        ? await listUsersWithPermission(ctx.agencyId, clientId, "task.review")
        : [];
    const managers =
      to === "blocked" ? await listUsersWithPermission(ctx.agencyId, clientId, "task.assign") : [];
    const people = [task.assigneeId, task.reporterId];
    switch (to) {
      case "ready_for_review":
        await notify(
          tx,
          base,
          after,
          reviewers.filter((r) => r !== task.assigneeId),
          actor.userId,
          { type: "task.review_requested", title: "A task is ready for review" },
        );
        break;
      case "approved":
        await notify(tx, base, after, people, actor.userId, {
          type: "task.approved",
          title: "A task was approved",
        });
        break;
      case "changes_requested":
        await notify(tx, base, after, people, actor.userId, {
          type: "task.changes_requested",
          title: "Changes were requested on a task",
          body: note,
        });
        break;
      case "blocked":
        await notify(tx, base, after, [...people, ...managers], actor.userId, {
          type: "task.blocked",
          title: "A task is blocked",
          body: note,
        });
        break;
      case "completed":
        await notify(tx, base, after, people, actor.userId, {
          type: "task.completed",
          title: "A task was completed",
        });
        break;
      case "cancelled":
        await notify(tx, base, after, people, actor.userId, {
          type: "task.cancelled",
          title: "A task was cancelled",
          body: note,
        });
        break;
    }
    return after;
  });
}

// ---- Dependencies -------------------------------------------------------------------------------------

/** Would making `taskId` wait for `dependsOnId` create a loop (A waits for B waits for ... A)? */
async function createsLoop(tx: Tx, taskId: string, dependsOnId: string): Promise<boolean> {
  const seen = new Set<string>();
  const queue = [dependsOnId];
  while (queue.length) {
    const current = queue.pop()!;
    if (current === taskId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    const next = await tx.taskDependency.findMany({
      where: { taskId: current },
      select: { dependsOnTaskId: true },
    });
    queue.push(...next.map((n) => n.dependsOnTaskId));
  }
  return false;
}

export async function addDependency(actor: Actor, taskId: string, dependsOnTaskId: string) {
  const { ctx, clientId } = await authorizeTask(actor, taskId);
  const base = { agencyId: ctx.agencyId, clientId };
  return prismaClient().$transaction(async (tx) => {
    const task = await loadRow(tx, taskId, clientId);
    if (!canEdit(ctx, actor, task)) throw new ForbiddenError("You cannot change this task");
    if (isClosed(task.status)) throw new ConflictError("This task is finished");
    if (taskId === dependsOnTaskId)
      throw new ValidationError({ dependsOnTaskId: ["A task cannot wait for itself"] });
    // Same client only: the id of another client's task is simply "not found".
    const other = await tx.task.findFirst({
      where: { id: dependsOnTaskId, clientId },
      select: { title: true },
    });
    if (!other) throw new NotFoundError("Task not found");
    if (await createsLoop(tx, taskId, dependsOnTaskId))
      throw new ConflictError(
        "That would create a loop: the other task already waits for this one",
      );
    try {
      await tx.taskDependency.create({ data: { ...base, taskId, dependsOnTaskId } });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002")
        throw new ConflictError("This task already waits for that one");
      throw error;
    }
    await event(tx, base, taskId, actor.userId, "dependency_added", undefined, {
      dependsOnTaskId,
      title: other.title,
    });
  });
}

export async function removeDependency(actor: Actor, taskId: string, dependsOnTaskId: string) {
  const { ctx, clientId } = await authorizeTask(actor, taskId);
  return prismaClient().$transaction(async (tx) => {
    const task = await loadRow(tx, taskId, clientId);
    if (!canEdit(ctx, actor, task)) throw new ForbiddenError("You cannot change this task");
    const removed = await tx.taskDependency.deleteMany({
      where: { taskId, dependsOnTaskId, clientId },
    });
    if (removed.count === 0) throw new NotFoundError("Dependency not found");
    await event(
      tx,
      { agencyId: ctx.agencyId, clientId },
      taskId,
      actor.userId,
      "dependency_removed",
      { dependsOnTaskId },
    );
  });
}

// ---- Comments ------------------------------------------------------------------------------------------

const commentSchema = z
  .string()
  .trim()
  .min(1, "Write a comment first")
  .max(5000, "Comments are limited to 5,000 characters");

export async function addComment(actor: Actor, taskId: string, body: string) {
  const text = parseInput(commentSchema, body);
  const { ctx, clientId } = await authorizeTask(actor, taskId);
  const p = ctx.access.permissions;
  if (!p.has("task.manage") && !p.has("task.review") && !p.has("task.assign"))
    throw new ForbiddenError("You cannot comment on tasks");
  const base = { agencyId: ctx.agencyId, clientId };
  return prismaClient().$transaction(async (tx) => {
    const task = await loadRow(tx, taskId, clientId);
    const comment = await tx.taskComment.create({
      data: { ...base, taskId, authorId: actor.userId, body: text },
    });
    await event(tx, base, taskId, actor.userId, "comment_added", undefined, {
      commentId: comment.id,
    });
    await notify(tx, base, task, [task.assigneeId, task.reporterId], actor.userId, {
      type: "task.comment",
      title: "New comment on a task",
      body: text.slice(0, 140),
    });
    return comment;
  });
}

export async function editComment(actor: Actor, commentId: string, body: string) {
  const text = parseInput(commentSchema, body);
  const comment = await prismaClient().taskComment.findUnique({
    where: { id: commentId },
    select: { id: true, taskId: true, authorId: true, deletedAt: true },
  });
  if (!comment) throw new NotFoundError("Comment not found");
  await authorizeTask(actor, comment.taskId);
  if (comment.authorId !== actor.userId || comment.deletedAt)
    throw new ForbiddenError("You can only edit your own comments");
  return prismaClient().taskComment.update({
    where: { id: commentId },
    data: { body: text, editedAt: new Date() },
  });
}

/** Comments are hidden, not erased: the activity trail stays complete. */
export async function deleteComment(actor: Actor, commentId: string) {
  const comment = await prismaClient().taskComment.findUnique({
    where: { id: commentId },
    select: { id: true, taskId: true, authorId: true },
  });
  if (!comment) throw new NotFoundError("Comment not found");
  const { ctx } = await authorizeTask(actor, comment.taskId);
  if (comment.authorId !== actor.userId && !ctx.access.permissions.has("task.assign"))
    throw new ForbiddenError("You can only delete your own comments");
  await prismaClient().taskComment.update({
    where: { id: commentId },
    data: { deletedAt: new Date() },
  });
}

// ---- Time tracking ----------------------------------------------------------------------------------------

const timeSchema = z.object({
  minutes: z.coerce
    .number()
    .int("Use whole minutes")
    .min(1, "At least 1 minute")
    .max(1440, "At most 24 hours in one entry"),
  note: optionalText(500, "The note"),
  workedOn: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.iso.date().optional(),
  ),
});

/** Record time worked. Actual effort on a task is the sum of its entries. */
export async function logTime(actor: Actor, taskId: string, input: z.input<typeof timeSchema>) {
  const data = parseInput(timeSchema, input);
  const { ctx, clientId } = await authorizeTask(actor, taskId);
  const base = { agencyId: ctx.agencyId, clientId };
  return prismaClient().$transaction(async (tx) => {
    const task = await loadRow(tx, taskId, clientId);
    const p = ctx.access.permissions;
    if (!(p.has("task.assign") || (p.has("task.manage") && task.assigneeId === actor.userId))) {
      throw new ForbiddenError("Only the assignee or a manager can log time on this task");
    }
    if (task.status === "cancelled") throw new ConflictError("This task was cancelled");
    const day = data.workedOn ?? new Date().toISOString().slice(0, 10);
    const startedAt = new Date(`${day}T12:00:00.000Z`);
    const entry = await tx.timeEntry.create({
      data: {
        ...base,
        userId: actor.userId,
        taskId,
        projectId: task.projectId,
        startedAt,
        endedAt: new Date(startedAt.getTime() + data.minutes * 60_000),
        durationSeconds: data.minutes * 60,
        note: data.note ?? null,
      },
    });
    await event(tx, base, taskId, actor.userId, "time_logged", undefined, {
      minutes: data.minutes,
      note: data.note ?? null,
    });
    return entry;
  });
}

export async function deleteTimeEntry(actor: Actor, entryId: string) {
  const entry = await prismaClient().timeEntry.findUnique({
    where: { id: entryId },
    select: { id: true, taskId: true, userId: true },
  });
  if (!entry?.taskId) throw new NotFoundError("Time entry not found");
  const { ctx } = await authorizeTask(actor, entry.taskId);
  if (entry.userId !== actor.userId && !ctx.access.permissions.has("task.assign"))
    throw new ForbiddenError("You can only remove your own time entries");
  await prismaClient().timeEntry.delete({ where: { id: entryId } });
}

// ---- Attachments --------------------------------------------------------------------------------------------

export const ALLOWED_ATTACHMENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const attachmentSchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .transform((n) => n.replace(/[\\/\u0000-\u001f]/g, "_")),
  mimeType: z
    .string()
    .refine(
      (v) => (ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(v),
      "That file type is not allowed",
    ),
  sizeBytes: z
    .number()
    .int()
    .min(1, "The file is empty")
    .max(MAX_ATTACHMENT_BYTES, "Files can be at most 10 MB"),
  storageKey: z.string().min(1).max(200),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type AttachmentInput = z.input<typeof attachmentSchema>;

/** Record a stored file (the bytes live in storage; the key is never a public URL). */
export async function addAttachment(actor: Actor, taskId: string, input: AttachmentInput) {
  const data = parseInput(attachmentSchema, input);
  const { ctx, clientId } = await authorizeTask(actor, taskId);
  const base = { agencyId: ctx.agencyId, clientId };
  return prismaClient().$transaction(async (tx) => {
    const task = await loadRow(tx, taskId, clientId);
    if (!canEdit(ctx, actor, task))
      throw new ForbiddenError("You cannot attach files to this task");
    if (task.status === "cancelled") throw new ConflictError("This task was cancelled");
    const attachment = await tx.taskAttachment.create({
      data: {
        ...base,
        taskId,
        uploadedById: actor.userId,
        fileName: data.fileName,
        mimeType: data.mimeType,
        sizeBytes: BigInt(data.sizeBytes),
        storageKey: data.storageKey,
        sha256: data.sha256,
      },
    });
    await event(tx, base, taskId, actor.userId, "attachment_added", undefined, {
      fileName: data.fileName,
      sizeBytes: data.sizeBytes,
    });
    return attachment;
  });
}

export async function removeAttachment(actor: Actor, attachmentId: string) {
  const a = await prismaClient().taskAttachment.findUnique({
    where: { id: attachmentId },
    select: { id: true, taskId: true, uploadedById: true },
  });
  if (!a) throw new NotFoundError("Attachment not found");
  const { ctx } = await authorizeTask(actor, a.taskId);
  if (a.uploadedById !== actor.userId && !ctx.access.permissions.has("task.assign"))
    throw new ForbiddenError("You can only remove your own attachments");
  await prismaClient().taskAttachment.update({
    where: { id: attachmentId },
    data: { deletedAt: new Date() },
  });
}

/** Metadata needed to stream a file, after proving the actor may see the task it belongs to. */
export async function getAttachmentForDownload(actor: Actor, attachmentId: string) {
  const a = await prismaClient().taskAttachment.findUnique({ where: { id: attachmentId } });
  if (!a || a.deletedAt) throw new NotFoundError("Attachment not found");
  await authorizeTask(actor, a.taskId);
  return {
    storageKey: a.storageKey,
    fileName: a.fileName,
    mimeType: a.mimeType,
    sizeBytes: Number(a.sizeBytes),
  };
}

// ---- Reassigning someone's open work -----------------------------------------------------------------------

/**
 * Move one person's open tasks to another (someone is away or leaving). Only on clients where the actor
 * can assign and the new person can do tasks; everything else is reported as skipped. One transaction.
 */
export async function reassignOpenTasks(
  actor: Actor,
  input: { fromUserId: string; toUserId: string; clientId?: string },
) {
  if (input.fromUserId === input.toUserId)
    throw new ValidationError({ toUserId: ["Choose a different person"] });
  const prisma = prismaClient();
  const candidates = await prisma.task.findMany({
    where: {
      assigneeId: input.fromUserId,
      status: { notIn: ["completed", "cancelled"] },
      ...(input.clientId ? { clientId: input.clientId } : {}),
    },
    select: { id: true, clientId: true, agencyId: true, status: true },
  });
  const clientIds = [...new Set(candidates.map((t) => t.clientId))];
  const allowed = new Set<string>();
  for (const clientId of clientIds) {
    const agencyId = candidates.find((t) => t.clientId === clientId)!.agencyId;
    try {
      const ctx = await requirePermission(actor, clientId, "task.assign");
      const access = await resolveUserAccess(input.toUserId, clientId, agencyId);
      if (ctx && access?.permissions.has("task.manage")) allowed.add(clientId);
    } catch (error) {
      if (!(error instanceof ForbiddenError || error instanceof NotFoundError)) throw error;
    }
  }
  const movable = candidates.filter((t) => allowed.has(t.clientId));
  await prisma.$transaction(async (tx) => {
    for (const t of movable) {
      const status: TaskStatusName =
        t.status === "in_progress" ? "assigned" : (t.status as TaskStatusName);
      await tx.task.update({ where: { id: t.id }, data: { assigneeId: input.toUserId, status } });
      const base = { agencyId: t.agencyId, clientId: t.clientId };
      await event(tx, base, t.id, actor.userId, "reassigned", input.fromUserId, input.toUserId);
      if (status !== t.status)
        await event(tx, base, t.id, actor.userId, "status_changed", t.status, status);
    }
    if (movable.length) {
      const first = movable[0]!;
      await tx.notification.create({
        data: {
          agencyId: first.agencyId,
          clientId: first.clientId,
          userId: input.toUserId,
          type: "task.assigned",
          title: `${movable.length} task${movable.length > 1 ? "s were" : " was"} reassigned to you`,
          entityType: "task",
          entityId: first.id,
          data: { count: movable.length },
        },
      });
      await recordAudit(tx, {
        actorUserId: actor.userId,
        agencyId: first.agencyId,
        clientId: null,
        action: "task.bulk_reassigned",
        entityType: "user",
        entityId: input.fromUserId,
        after: { toUserId: input.toUserId, moved: movable.length },
      });
    }
  });
  return { moved: movable.length, skipped: candidates.length - movable.length };
}
