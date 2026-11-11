import { recordAudit } from "../audit";
import { listUsersWithPermission } from "../access";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import type { Prisma, TaskStatus } from "../generated/client";
import { createTaskForAutomation } from "../services/tasks";
import { getUnscopedPrisma } from "../unsafe";
import {
  PRIORITY_BY_SEVERITY,
  NOTIFY_ONLY_KINDS,
  assignmentSchema,
  computeDueDate,
  configSchemas,
  cooldownSchema,
  duePolicySchema,
  notifyPolicySchema,
  renderTemplate,
  taskTemplateSchema,
  type Assignment,
  type Cooldown,
  type NotifyPolicy,
  type RuleKind,
} from "./config";
import { EVALUATORS, type Finding } from "./evaluators";

/**
 * The monitoring engine. A tick (1) queues a run for every active rule that is due, once per time bucket,
 * (2) claims queued runs one at a time, (3) evaluates real data, (4) records findings, creates tasks and
 * notifies people, and (5) records everything it did. Every step is idempotent, so a crashed or retried
 * run never duplicates a finding, a task or a notification:
 *   - findings are unique per (client, dedupe key);
 *   - an open task can exist only once per (client, automation key) - enforced by the database;
 *   - task creation also carries an idempotency key;
 *   - notifications are tied to the finding's `last_notified_at`.
 * Loop prevention: nothing here reacts to task events (rules run on a schedule only), the overdue rule
 * never creates tasks, and creation is capped per run and by the number of open automation tasks.
 */

const prisma = () => getUnscopedPrisma();
export const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 5 * 60_000;
const STALE_RUN_MS = 20 * 60_000;
const MAX_STEP_ROWS = 100;
const OPEN_TASK = { notIn: ["completed", "cancelled"] as TaskStatus[] };

export type RunSummary = {
  findings?: number;
  newFindings?: number;
  tasksCreated?: number;
  deduped?: number;
  cooledDown?: number;
  capped?: number;
  notified?: number;
  resolved?: number;
  failed?: number;
  skippedReason?: string;
  reviewQueue?: number;
};

const safeMessage = (e: unknown) =>
  e instanceof ConflictError || e instanceof NotFoundError || e instanceof ValidationError
    ? e.message.slice(0, 300)
    : "An unexpected error occurred while running this step.";
const retryable = (e: unknown) =>
  !(e instanceof ConflictError || e instanceof NotFoundError || e instanceof ValidationError);
const isUnique = (e: unknown) => (e as { code?: string }).code === "P2002";

// ---- Scheduling ---------------------------------------------------------------------------------------------------

/** Queue a run for each due active rule (once per interval bucket) and re-queue failed runs whose retry time has come. */
export async function queueDueAutomationRuns(
  now = new Date(),
): Promise<{ queued: number; retried: number }> {
  // Retries first: a failed run waiting for its retry must get its slot before a fresh scheduled run takes it.
  let retried = 0;
  const failed = await prisma().automationRun.findMany({
    where: {
      status: "failed",
      nextAttemptAt: { lte: now },
      attempt: { lt: MAX_ATTEMPTS },
      rule: { status: "active" },
    },
    select: { id: true },
  });
  for (const f of failed) {
    try {
      await prisma().automationRun.update({
        where: { id: f.id },
        data: {
          status: "queued",
          attempt: { increment: 1 },
          nextAttemptAt: null,
          startedAt: null,
          finishedAt: null,
        },
      });
      retried++;
    } catch (error) {
      if (!isUnique(error)) throw error; // the rule already has an active run
    }
  }
  const rules = await prisma().automationRule.findMany({
    where: {
      status: "active",
      kind: { not: null },
      archivedAt: null,
      client: { status: "active" },
    },
    select: {
      id: true,
      agencyId: true,
      clientId: true,
      intervalMinutes: true,
      lastRunAt: true,
      version: true,
      automationRuns: {
        where: { status: { in: ["queued", "running"] } },
        select: { id: true },
        take: 1,
      },
    },
  });
  let queued = 0;
  for (const r of rules) {
    if (r.automationRuns.length > 0) continue;
    const intervalMs = r.intervalMinutes * 60_000;
    if (r.lastRunAt && now.getTime() - r.lastRunAt.getTime() < intervalMs) continue;
    const bucket = String(Math.floor(now.getTime() / intervalMs));
    try {
      await prisma().$transaction(async (tx) => {
        // One run per rule per interval bucket, however many workers or ticks ask for it.
        const key = await tx.idempotencyKey.create({
          data: {
            agencyId: r.agencyId,
            clientId: r.clientId,
            scope: `automation.run.${r.id}`,
            key: bucket,
            expiresAt: new Date(now.getTime() + 30 * 86_400_000),
          },
        });
        await tx.automationRun.create({
          data: {
            agencyId: r.agencyId,
            clientId: r.clientId,
            ruleId: r.id,
            ruleVersion: r.version,
            trigger: "schedule",
            status: "queued",
            idempotencyKeyId: key.id,
          },
        });
      });
      queued++;
    } catch (error) {
      if (!isUnique(error)) throw error; // already queued for this bucket: fine
    }
  }

  return { queued, retried };
}

/** Take the oldest queued run (safe with several workers). */
export async function claimNextAutomationRun(): Promise<string | null> {
  const rows = await prisma().$queryRaw<{ id: string }[]>`
    UPDATE automation_runs SET status = 'running', started_at = now()
    WHERE id = (SELECT id FROM automation_runs WHERE status = 'queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id`;
  return rows[0]?.id ?? null;
}

/** A run stuck "running" (worker crashed) is failed and scheduled for a retry. */
export async function failStaleAutomationRuns(now = new Date()): Promise<number> {
  const stale = await prisma().automationRun.findMany({
    where: { status: "running", startedAt: { lt: new Date(now.getTime() - STALE_RUN_MS) } },
    select: { id: true, attempt: true },
  });
  for (const r of stale)
    await prisma().automationRun.update({
      where: { id: r.id },
      data: {
        status: "failed",
        finishedAt: now,
        error: "The worker stopped while running this rule.",
        nextAttemptAt: r.attempt < MAX_ATTEMPTS ? new Date(now.getTime() + RETRY_BASE_MS) : null,
      },
    });
  return stale.length;
}

// ---- Assignment ---------------------------------------------------------------------------------------------------

async function usersWithRole(
  agencyId: string,
  clientId: string,
  roleKey: string,
): Promise<string[]> {
  const hasRole = { some: { role: { key: roleKey } } };
  const [direct, wide] = await Promise.all([
    prisma().clientMembership.findMany({
      where: {
        clientId,
        status: "active",
        roles: hasRole,
        agencyMembership: { status: "active", user: { deactivatedAt: null } },
      },
      select: { userId: true },
    }),
    prisma().agencyMembership.findMany({
      where: {
        agencyId,
        status: "active",
        allClientsAccess: true,
        roles: hasRole,
        user: { deactivatedAt: null },
      },
      select: { userId: true },
    }),
  ]);
  return [...new Set([...direct, ...wide].map((m) => m.userId))];
}

export type Assigned = { userId: string | null; reviewQueue: boolean; reason: string };

/**
 * Decide who gets a task. Only people who can actually work tasks on this client are candidates; when
 * the policy cannot be satisfied the task goes to the review queue (unassigned, reviewers are told)
 * instead of failing.
 */
export async function resolveAssignee(
  scope: { agencyId: string; clientId: string },
  policy: Assignment,
  ownerUserId: string | null | undefined,
): Promise<Assigned> {
  const queue = (reason: string): Assigned => ({ userId: null, reviewQueue: true, reason });
  if (policy.mode === "review_queue") return queue("Review queue by policy");
  const workers = new Set(
    await listUsersWithPermission(scope.agencyId, scope.clientId, "task.manage"),
  );
  if (policy.mode === "user")
    return policy.userId && workers.has(policy.userId)
      ? { userId: policy.userId, reviewQueue: false, reason: "Named person" }
      : queue("The chosen person cannot take tasks on this client");
  if (policy.mode === "entity_owner" && ownerUserId && workers.has(ownerUserId))
    return { userId: ownerUserId, reviewQueue: false, reason: "Owner of the item" };
  const holders = (await usersWithRole(scope.agencyId, scope.clientId, policy.roleKey))
    .filter((u) => workers.has(u))
    .sort();
  if (holders.length === 0)
    return queue(
      `Nobody with the ${policy.roleKey.replace(/_/g, " ")} role can take tasks on this client`,
    );
  if (policy.strategy === "first" || holders.length === 1)
    return {
      userId: holders[0]!,
      reviewQueue: false,
      reason: `${policy.roleKey.replace(/_/g, " ")} (first)`,
    };
  const loads = await prisma().task.groupBy({
    by: ["assigneeId"],
    where: {
      clientId: scope.clientId,
      assigneeId: { in: holders },
      status: OPEN_TASK,
      archivedAt: null,
    },
    _count: { _all: true },
  });
  const load = new Map(loads.map((l) => [l.assigneeId!, l._count._all]));
  const pick = [...holders].sort(
    (a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0) || a.localeCompare(b),
  )[0]!;
  return {
    userId: pick,
    reviewQueue: false,
    reason: `${policy.roleKey.replace(/_/g, " ")} with the fewest open tasks`,
  };
}

// ---- Execution ----------------------------------------------------------------------------------------------------

type RuleRow = Prisma.AutomationRuleGetPayload<{
  include: { client: { select: { id: true; agencyId: true; timezone: true; status: true } } };
}>;

async function notify(args: {
  rule: RuleRow;
  runId: string;
  findingId: string;
  finding: Finding;
  policy: NotifyPolicy;
  assigneeId: string | null;
  reviewQueue: boolean;
  taskId: string | null;
  created: boolean;
}): Promise<number> {
  const { rule, policy } = args;
  if (!policy.enabled) return 0;
  const recipients = new Set<string>();
  if (policy.assignee && (args.assigneeId ?? args.finding.ownerUserId))
    recipients.add((args.assigneeId ?? args.finding.ownerUserId)!);
  if (policy.managers)
    for (const u of await listUsersWithPermission(rule.agencyId, rule.clientId, "task.assign"))
      recipients.add(u);
  if (policy.reviewers || args.reviewQueue)
    for (const u of await listUsersWithPermission(rule.agencyId, rule.clientId, "task.review"))
      recipients.add(u);
  if (recipients.size === 0) return 0;
  const title = args.created ? `New task: ${args.finding.title}` : args.finding.title;
  await prisma().notification.createMany({
    data: [...recipients].map((userId) => ({
      agencyId: rule.agencyId,
      clientId: rule.clientId,
      userId,
      type: args.created ? "automation.task_created" : "automation.finding",
      title: title.slice(0, 200),
      body: `${rule.name}${args.reviewQueue ? " · in the review queue" : ""}`,
      entityType: args.taskId ? "task" : "automation_finding",
      entityId: args.taskId ?? args.findingId,
      data: {
        ruleId: rule.id,
        runId: args.runId,
        findingId: args.findingId,
        taskId: args.taskId,
        severity: args.finding.severity,
      },
    })),
  });
  return recipients.size;
}

async function recordStep(
  scope: { agencyId: string; clientId: string },
  runId: string,
  attempt: number,
  index: number,
  key: string,
  action: string,
  status: "succeeded" | "failed" | "skipped",
  output: unknown,
  error?: string,
) {
  if (index >= MAX_STEP_ROWS) return;
  const now = new Date();
  await prisma()
    .automationStepRun.upsert({
      where: { runId_stepIndex_attempt: { runId, stepIndex: index, attempt } },
      create: {
        agencyId: scope.agencyId,
        clientId: scope.clientId,
        runId,
        stepIndex: index,
        attempt,
        stepKey: key,
        action,
        status,
        output: output as Prisma.InputJsonValue,
        error: error ?? null,
        startedAt: now,
        finishedAt: now,
      },
      update: {
        status,
        output: output as Prisma.InputJsonValue,
        error: error ?? null,
        finishedAt: now,
      },
    })
    .catch(() => undefined);
}

async function finishRun(
  runId: string,
  ruleId: string,
  data: {
    status: "succeeded" | "failed" | "skipped";
    summary: RunSummary;
    error?: string;
    nextAttemptAt?: Date | null;
  },
) {
  const now = new Date();
  await prisma().$transaction(async (tx) => {
    const run = await tx.automationRun.update({
      where: { id: runId },
      data: {
        status: data.status,
        summary: data.summary as Prisma.InputJsonObject,
        error: data.error ?? null,
        nextAttemptAt: data.nextAttemptAt ?? null,
        finishedAt: now,
      },
      select: { agencyId: true, clientId: true },
    });
    // A failed run is retried on its own schedule: leave last_run_at alone so the rule is not considered "done".
    if (data.status !== "failed")
      await tx.automationRule.update({ where: { id: ruleId }, data: { lastRunAt: now } });
    await recordAudit(tx, {
      actorUserId: null,
      agencyId: run.agencyId,
      clientId: run.clientId,
      action: `automation.run_${data.status}`,
      entityType: "automation_run",
      entityId: runId,
      after: data.summary as Prisma.InputJsonObject,
    });
  });
}

/** Run one claimed execution. Never throws: every outcome is recorded on the run. */
export async function executeAutomationRun(runId: string, now = new Date()): Promise<void> {
  const run = await prisma().automationRun.findUnique({
    where: { id: runId },
    include: {
      rule: {
        include: { client: { select: { id: true, agencyId: true, timezone: true, status: true } } },
      },
    },
  });
  if (!run) return;
  const rule = run.rule;
  const attempt = run.attempt;
  const rs = (
    index: number,
    key: string,
    action: string,
    status: "succeeded" | "failed" | "skipped",
    output: unknown,
    error?: string,
  ) =>
    recordStep(
      { agencyId: rule.agencyId, clientId: rule.clientId },
      runId,
      attempt,
      index,
      key,
      action,
      status,
      output,
      error,
    );
  const fail = (error: string, retry: boolean, summary: RunSummary = {}) =>
    finishRun(runId, rule.id, {
      status: "failed",
      summary,
      error,
      nextAttemptAt:
        retry && attempt < MAX_ATTEMPTS
          ? new Date(now.getTime() + RETRY_BASE_MS * 2 ** (attempt - 1))
          : null,
    });

  if (run.status !== "running") return;
  const kind = rule.kind as RuleKind | null;
  if (!kind || rule.status !== "active" || rule.client.status !== "active")
    return finishRun(runId, rule.id, {
      status: "skipped",
      summary: {
        skippedReason: !kind
          ? "Not a monitoring rule"
          : rule.status !== "active"
            ? "The rule is not active"
            : "The client is not active",
      },
    });

  const config = configSchemas[kind].safeParse(rule.config);
  const assignment = assignmentSchema.safeParse(rule.assignment);
  const template = taskTemplateSchema.safeParse(rule.taskTemplate);
  const due = duePolicySchema.safeParse(rule.duePolicy);
  const notifyP = notifyPolicySchema.safeParse(rule.notifyPolicy);
  const cooldown = cooldownSchema.safeParse(rule.cooldown);
  if (
    !config.success ||
    !assignment.success ||
    !due.success ||
    !notifyP.success ||
    !cooldown.success ||
    (!template.success && !NOTIFY_ONLY_KINDS.includes(kind))
  )
    return fail("The rule's settings are invalid. Edit and save the rule.", false);
  const createTasks =
    !NOTIFY_ONLY_KINDS.includes(kind) && template.success && template.data.createTask;
  const cd: Cooldown = cooldown.data;

  // 1-2. Validate the source data and freshness, then evaluate the conditions.
  let outcome;
  try {
    outcome = await EVALUATORS[kind]({
      agencyId: rule.agencyId,
      clientId: rule.clientId,
      projectId: rule.projectId,
      timezone: rule.client.timezone,
      now,
      severity: rule.severity as Finding["severity"],
      config: config.data,
    });
  } catch (error) {
    await rs(0, "evaluate", "evaluate", "failed", {}, safeMessage(error));
    return fail(safeMessage(error), retryable(error));
  }
  await rs(0, "validate", "validate_data", outcome.status === "ok" ? "succeeded" : "skipped", {
    status: outcome.status,
    reason: outcome.reason ?? null,
    checked: outcome.checked,
  });
  if (outcome.status !== "ok")
    return finishRun(runId, rule.id, {
      status: "skipped",
      summary: { skippedReason: outcome.reason ?? outcome.status, findings: 0 },
    });
  await rs(1, "evaluate", "evaluate", "succeeded", {
    findings: outcome.findings.length,
    checked: outcome.checked,
  });

  // 3-9. Per finding: record, dedupe, assign, create the task, notify.
  const summary: RunSummary = {
    findings: outcome.findings.length,
    newFindings: 0,
    tasksCreated: 0,
    deduped: 0,
    cooledDown: 0,
    capped: 0,
    notified: 0,
    resolved: 0,
    failed: 0,
    reviewQueue: 0,
  };
  let openAutomationTasks = createTasks
    ? await prisma().task.count({
        where: {
          clientId: rule.clientId,
          source: "automation",
          status: OPEN_TASK,
          archivedAt: null,
        },
      })
    : 0;
  const errors: string[] = [];
  let retry = false;
  let step = 2;

  for (const f of outcome.findings) {
    try {
      const result = await handleFinding({
        rule,
        runId,
        now,
        f,
        createTasks,
        template: template.success ? template.data : null,
        assignment: assignment.data,
        due: due.data,
        notifyPolicy: notifyP.data,
        cooldown: cd,
        capped:
          summary.tasksCreated! >= cd.maxTasksPerRun || openAutomationTasks >= cd.maxOpenTasks,
      });
      summary.newFindings! += result.isNew ? 1 : 0;
      summary.tasksCreated! += result.taskCreated ? 1 : 0;
      openAutomationTasks += result.taskCreated ? 1 : 0;
      summary.deduped! += result.deduped ? 1 : 0;
      summary.cooledDown! += result.cooledDown ? 1 : 0;
      summary.capped! += result.capped ? 1 : 0;
      summary.notified! += result.notified;
      summary.reviewQueue! += result.reviewQueue ? 1 : 0;
      await rs(step++, f.dedupeKey, "finding", "succeeded", {
        title: f.title,
        new: result.isNew,
        taskId: result.taskId,
        taskCreated: result.taskCreated,
        deduped: result.deduped,
        cooledDown: result.cooledDown,
        capped: result.capped,
        assignee: result.assignedReason,
        notified: result.notified,
      });
    } catch (error) {
      summary.failed! += 1;
      errors.push(safeMessage(error));
      retry ||= retryable(error);
      await rs(step++, f.dedupeKey, "finding", "failed", { title: f.title }, safeMessage(error));
    }
  }

  // 10. A condition that no longer holds (with fresh data) resolves its finding. Tasks stay: closing work is a human decision.
  const complete = !(
    kind === "page_needs_optimization" &&
    outcome.findings.length >= (config.data as { maxFindings: number }).maxFindings
  );
  if (complete && summary.failed === 0) {
    const current = outcome.findings.map((f) => f.dedupeKey);
    const resolved = await prisma().automationFinding.updateMany({
      where: {
        clientId: rule.clientId,
        ruleId: rule.id,
        kind,
        status: "open",
        dedupeKey: { notIn: current },
      },
      data: { status: "resolved", resolvedAt: now },
    });
    summary.resolved = resolved.count;
  }

  if (summary.failed! > 0)
    return fail(
      `${summary.failed} of ${outcome.findings.length} findings could not be processed: ${[...new Set(errors)].slice(0, 2).join(" ")}`,
      retry,
      summary,
    );
  await finishRun(runId, rule.id, { status: "succeeded", summary });
}

type FindingResult = {
  isNew: boolean;
  taskCreated: boolean;
  taskId: string | null;
  deduped: boolean;
  cooledDown: boolean;
  capped: boolean;
  notified: number;
  reviewQueue: boolean;
  assignedReason: string | null;
};

async function handleFinding(a: {
  rule: RuleRow;
  runId: string;
  now: Date;
  f: Finding;
  createTasks: boolean;
  template: ReturnType<typeof taskTemplateSchema.parse> | null;
  assignment: Assignment;
  due: ReturnType<typeof duePolicySchema.parse>;
  notifyPolicy: NotifyPolicy;
  cooldown: Cooldown;
  capped: boolean;
}): Promise<FindingResult> {
  const { rule, now, f } = a;
  const kind = rule.kind as RuleKind;
  const out: FindingResult = {
    isNew: false,
    taskCreated: false,
    taskId: null,
    deduped: false,
    cooledDown: false,
    capped: false,
    notified: 0,
    reviewQueue: false,
    assignedReason: null,
  };

  // Record or update the finding (one per condition, however many rules or runs see it).
  const existing = await prisma().automationFinding.findUnique({
    where: { clientId_dedupeKey: { clientId: rule.clientId, dedupeKey: f.dedupeKey } },
    include: { task: { select: { id: true, status: true, updatedAt: true } } },
  });
  const reopened = existing?.status === "resolved";
  const base = {
    severity: f.severity,
    title: f.title.slice(0, 300),
    details: f.details as Prisma.InputJsonObject,
    lastSeenAt: now,
    projectId: f.projectId ?? rule.projectId,
    seoIssueId: f.seoIssueId ?? null,
  };
  const finding = existing
    ? await prisma().automationFinding.update({
        where: { id: existing.id },
        data: {
          ...base,
          ruleId: rule.id,
          occurrences: { increment: 1 },
          ...(reopened ? { status: "open", resolvedAt: null } : {}),
        },
      })
    : await prisma().automationFinding.create({
        data: {
          ...base,
          agencyId: rule.agencyId,
          clientId: rule.clientId,
          ruleId: rule.id,
          kind,
          dedupeKey: f.dedupeKey,
          entityType: f.entityType,
          entityId: f.entityId,
        },
      });
  out.isNew = !existing || reopened;

  let taskId: string | null =
    existing?.task && !["completed", "cancelled"].includes(existing.task.status)
      ? existing.task.id
      : null;
  let assigneeId: string | null = null;
  let reviewQueue = false;

  if (!a.createTasks || !a.template) {
    // Notify-only (or "record only"): an existing task (e.g. the overdue one) is only linked.
    if (f.existingTaskId && !finding.taskId)
      await prisma().automationFinding.update({
        where: { id: finding.id },
        data: { taskId: f.existingTaskId },
      });
    taskId = f.existingTaskId ?? taskId;
  } else if (f.existingTaskId || taskId) {
    // 3. A matching open task already exists (audit issue task, content task, an earlier automation task): link it, create nothing.
    taskId = f.existingTaskId ?? taskId;
    if (finding.taskId !== taskId)
      await prisma().automationFinding.update({ where: { id: finding.id }, data: { taskId } });
    out.deduped = true;
  } else if (
    existing?.task &&
    a.cooldown.hours > 0 &&
    now.getTime() - existing.task.updatedAt.getTime() < a.cooldown.hours * 3_600_000
  ) {
    out.cooledDown = true; // its last task was closed recently: do not nag
  } else if (a.capped) {
    out.capped = true;
  } else {
    const assigned = await resolveAssignee(
      { agencyId: rule.agencyId, clientId: rule.clientId },
      a.assignment,
      f.ownerUserId,
    );
    assigneeId = assigned.userId;
    reviewQueue = assigned.reviewQueue;
    out.assignedReason = assigned.reason;
    const vars = { ...f.vars, severity: f.severity };
    const created = await createOrFindTask({
      rule,
      runId: a.runId,
      f,
      finding,
      template: a.template,
      vars,
      assigneeId,
      dueDate: computeDueDate(a.due, f.severity, now, rule.client.timezone),
    });
    taskId = created.id;
    out.taskCreated = created.created;
    out.deduped = !created.created;
    await prisma().automationFinding.update({
      where: { id: finding.id },
      data: { taskId, ...(created.created ? { taskCount: { increment: 1 } } : {}) },
    });
  }
  out.taskId = taskId;
  out.reviewQueue = reviewQueue;

  // 9. Tell the responsible people, once per new / reopened / escalated finding (or after the re-notify interval).
  const details = (finding.details ?? {}) as { escalatedNotified?: boolean };
  const escalateNow = Boolean(f.escalate) && !details.escalatedNotified;
  const reNotify =
    a.notifyPolicy.reNotifyHours > 0 &&
    finding.lastNotifiedAt !== null &&
    now.getTime() - finding.lastNotifiedAt.getTime() >= a.notifyPolicy.reNotifyHours * 3_600_000;
  if (finding.lastNotifiedAt === null || reopened || out.taskCreated || escalateNow || reNotify) {
    const policy = escalateNow ? { ...a.notifyPolicy, managers: true } : a.notifyPolicy;
    if (taskId && !assigneeId) {
      const t = await prisma().task.findUnique({
        where: { id: taskId },
        select: { assigneeId: true },
      });
      assigneeId = t?.assigneeId ?? null;
    }
    out.notified = await notify({
      rule,
      runId: a.runId,
      findingId: finding.id,
      finding: f,
      policy,
      assigneeId,
      reviewQueue,
      taskId,
      created: out.taskCreated,
    });
    await prisma().automationFinding.update({
      where: { id: finding.id },
      data: {
        lastNotifiedAt: now,
        ...(f.escalate
          ? { details: { ...(finding.details as object), escalatedNotified: true } }
          : {}),
      },
    });
  }
  return out;
}

async function createOrFindTask(a: {
  rule: RuleRow;
  runId: string;
  f: Finding;
  finding: { id: string; taskCount: number };
  template: ReturnType<typeof taskTemplateSchema.parse>;
  vars: Record<string, string | number | null>;
  assigneeId: string | null;
  dueDate: string;
}) {
  const { rule, f, template } = a;
  try {
    return await createTaskForAutomation({
      clientId: rule.clientId,
      ruleId: rule.id,
      runId: a.runId,
      title: renderTemplate(template.title, a.vars, 200) || f.title.slice(0, 200),
      description: renderTemplate(template.description, a.vars) || undefined,
      acceptanceCriteria: renderTemplate(template.acceptanceCriteria, a.vars) || undefined,
      type: template.type,
      priority: PRIORITY_BY_SEVERITY[f.severity],
      labels: template.labels,
      estimateMinutes: template.estimateMinutes,
      projectId: f.projectId ?? rule.projectId ?? undefined,
      dueDate: a.dueDate,
      assigneeId: a.assigneeId ?? undefined,
      seoIssueIds: f.seoIssueId ? [f.seoIssueId] : [],
      contentItemId: f.entityType === "content_item" ? f.entityId : undefined,
      automationKey: f.dedupeKey,
      // Retrying the same run returns the same task; the next cycle (after this one is closed) gets a new key.
      idempotencyKey: `${f.dedupeKey}:${a.finding.taskCount}`,
    });
  } catch (error) {
    if (!isUnique(error)) throw error;
    // The database refused a second open task for this key: someone (another rule or run) just created it. Use that one.
    const open = await prisma().task.findFirst({
      where: { clientId: rule.clientId, automationKey: f.dedupeKey, status: OPEN_TASK },
      select: { id: true },
    });
    if (!open) throw error;
    return { id: open.id, created: false };
  }
}
