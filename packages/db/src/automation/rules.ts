import { ZodError } from "zod";
import {
  clientIdsWith,
  forClients,
  getAccessMap,
  listAgenciesWith,
  requireAgencyPermission,
  requirePermission,
  type Actor,
} from "../access";
import { recordAudit } from "../audit";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import type { Prisma } from "../generated/client";
import { PAGE_SIZE, clampPage, paged } from "../services/paging";
import { getUnscopedPrisma } from "../unsafe";
import {
  RECOMMENDED_RULES,
  RULE_KINDS,
  parseRulePayload,
  type ParsedRulePayload,
  type RulePayload,
} from "./config";

/** Rules, agency templates, executions and findings: the people-facing side of the automation engine. */

const prisma = () => getUnscopedPrisma();
const isUnique = (e: unknown) => (e as { code?: string }).code === "P2002";

function validate(input: unknown): ParsedRulePayload {
  try {
    return parseRulePayload(input);
  } catch (error) {
    if (error instanceof ZodError) {
      const fields: Record<string, string[]> = {};
      for (const i of error.issues) (fields[i.path.join(".") || "form"] ??= []).push(i.message);
      throw new ValidationError(fields);
    }
    throw error;
  }
}

const payloadData = (p: ParsedRulePayload) => ({
  name: p.name,
  description: p.description ?? null,
  kind: p.kind,
  severity: p.severity,
  intervalMinutes: p.intervalMinutes,
  config: p.config as Prisma.InputJsonObject,
  assignment: p.assignment as Prisma.InputJsonObject,
  taskTemplate: p.taskTemplate as Prisma.InputJsonObject,
  duePolicy: p.duePolicy as Prisma.InputJsonObject,
  notifyPolicy: p.notifyPolicy as Prisma.InputJsonObject,
  cooldown: p.cooldown as Prisma.InputJsonObject,
});

// ---- Rules --------------------------------------------------------------------------------------------------------

export async function listRules(actor: Actor, f: { clientId?: string; page?: number } = {}) {
  const map = await getAccessMap(actor);
  const allowed = clientIdsWith(map, "automation.view");
  const ids = f.clientId ? allowed.filter((c) => c === f.clientId) : allowed;
  if (ids.length === 0) return { ...paged([], 0, 1), canManage: false };
  const page = clampPage(f.page);
  const where: Prisma.AutomationRuleWhereInput = {
    clientId: { in: ids },
    archivedAt: null,
    kind: { not: null },
  };
  const db = forClients(ids);
  const [rows, total] = await Promise.all([
    db.automationRule.findMany({
      where,
      orderBy: [{ client: { name: "asc" } }, { name: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        clientId: true,
        name: true,
        kind: true,
        severity: true,
        status: true,
        intervalMinutes: true,
        lastRunAt: true,
        customized: true,
        projectId: true,
        client: { select: { name: true } },
        project: { select: { name: true } },
        template: { select: { name: true } },
        automationRuns: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true, createdAt: true, summary: true, error: true },
        },
        _count: { select: { findings: { where: { status: "open" } } } },
      },
    }),
    db.automationRule.count({ where }),
  ]);
  const manage = new Set(clientIdsWith(map, "automation.manage"));
  return {
    ...paged(
      rows.map((r) => ({
        ...r,
        nextRunAt:
          r.status === "active"
            ? new Date((r.lastRunAt?.getTime() ?? Date.now()) + r.intervalMinutes * 60_000)
            : null,
        lastRun: r.automationRuns[0] ?? null,
        openFindings: r._count.findings,
        canManage: manage.has(r.clientId),
      })),
      total,
      page,
    ),
    canManage: ids.some((c) => manage.has(c)),
  };
}

async function loadRule(ruleId: string) {
  const rule = await prisma().automationRule.findUnique({ where: { id: ruleId } });
  if (!rule || rule.archivedAt || !rule.kind) throw new NotFoundError("Rule not found");
  return rule;
}

export async function getRule(actor: Actor, ruleId: string) {
  const found = await loadRule(ruleId);
  const ctx = await requirePermission(actor, found.clientId, "automation.view");
  const rule = await ctx.db.automationRule.findFirstOrThrow({
    where: { id: ruleId },
    include: {
      client: { select: { name: true } },
      project: { select: { name: true } },
      template: { select: { name: true } },
    },
  });
  const manage = await requirePermission(actor, found.clientId, "automation.manage")
    .then(() => true)
    .catch(() => false);
  return { rule, canManage: manage };
}

async function assertProject(clientId: string, projectId: string | null | undefined) {
  if (!projectId) return;
  const p = await prisma().project.findFirst({
    where: { id: projectId, clientId, archivedAt: null },
    select: { id: true },
  });
  if (!p) throw new ValidationError({ projectId: ["Choose one of this client's projects"] });
}

export async function createRule(
  actor: Actor,
  input: { clientId: string; projectId?: string | null; enabled?: boolean; payload: RulePayload },
) {
  const ctx = await requirePermission(actor, input.clientId, "automation.manage");
  const payload = validate(input.payload);
  await assertProject(input.clientId, input.projectId);
  return prisma().$transaction(async (tx) => {
    try {
      const rule = await tx.automationRule.create({
        data: {
          ...payloadData(payload),
          agencyId: ctx.agencyId,
          clientId: input.clientId,
          projectId: input.projectId ?? null,
          trigger: "schedule",
          status: input.enabled ? "active" : "paused",
          createdById: actor.userId,
        },
        select: { id: true },
      });
      await recordAudit(tx, {
        actorUserId: actor.userId,
        agencyId: ctx.agencyId,
        clientId: input.clientId,
        action: "automation.rule_created",
        entityType: "automation_rule",
        entityId: rule.id,
        after: { name: payload.name, kind: payload.kind, enabled: !!input.enabled },
      });
      return rule;
    } catch (error) {
      if (isUnique(error))
        throw new ConflictError("A rule with this name already exists for this client");
      throw error;
    }
  });
}

export async function updateRule(
  actor: Actor,
  ruleId: string,
  input: { projectId?: string | null; payload: RulePayload },
) {
  const found = await loadRule(ruleId);
  const ctx = await requirePermission(actor, found.clientId, "automation.manage");
  const payload = validate(input.payload);
  if (payload.kind !== found.kind)
    throw new ValidationError({
      kind: ["A rule's type cannot be changed. Create a new rule instead"],
    });
  await assertProject(found.clientId, input.projectId);
  return prisma().$transaction(async (tx) => {
    try {
      await tx.automationRule.update({
        where: { id: ruleId },
        // A rule that came from a template is now the client's own: later template updates leave it alone.
        data: {
          ...payloadData(payload),
          projectId: input.projectId === undefined ? undefined : input.projectId,
          version: { increment: 1 },
          customized: found.templateId ? true : undefined,
        },
      });
    } catch (error) {
      if (isUnique(error))
        throw new ConflictError("A rule with this name already exists for this client");
      throw error;
    }
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: found.clientId,
      action: "automation.rule_updated",
      entityType: "automation_rule",
      entityId: ruleId,
      before: { version: found.version },
      after: { name: payload.name },
    });
  });
}

export async function setRuleEnabled(actor: Actor, ruleId: string, enabled: boolean) {
  const found = await loadRule(ruleId);
  const ctx = await requirePermission(actor, found.clientId, "automation.manage");
  await prisma().$transaction(async (tx) => {
    await tx.automationRule.update({
      where: { id: ruleId },
      data: { status: enabled ? "active" : "paused", version: { increment: 1 } },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: found.clientId,
      action: enabled ? "automation.rule_enabled" : "automation.rule_paused",
      entityType: "automation_rule",
      entityId: ruleId,
      before: { status: found.status },
    });
  });
}

export async function archiveRule(actor: Actor, ruleId: string) {
  const found = await loadRule(ruleId);
  const ctx = await requirePermission(actor, found.clientId, "automation.manage");
  await prisma().$transaction(async (tx) => {
    await tx.automationRule.update({
      where: { id: ruleId },
      data: {
        status: "archived",
        archivedAt: new Date(),
        name: `${found.name} (archived ${Date.now()})`.slice(0, 200),
      },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: found.clientId,
      action: "automation.rule_archived",
      entityType: "automation_rule",
      entityId: ruleId,
    });
  });
}

/** Queue an immediate run. The worker executes it; nothing runs inside the web request. */
export async function runRuleNow(actor: Actor, ruleId: string) {
  const found = await loadRule(ruleId);
  const ctx = await requirePermission(actor, found.clientId, "automation.manage");
  if (found.status !== "active") throw new ConflictError("Enable the rule before running it");
  return prisma().$transaction(async (tx) => {
    try {
      const run = await tx.automationRun.create({
        data: {
          agencyId: ctx.agencyId,
          clientId: found.clientId,
          ruleId,
          ruleVersion: found.version,
          trigger: "manual",
          status: "queued",
        },
        select: { id: true },
      });
      await recordAudit(tx, {
        actorUserId: actor.userId,
        agencyId: ctx.agencyId,
        clientId: found.clientId,
        action: "automation.run_requested",
        entityType: "automation_run",
        entityId: run.id,
      });
      return run;
    } catch (error) {
      if (isUnique(error)) throw new ConflictError("This rule is already queued or running");
      throw error;
    }
  });
}

/** Create the seven recommended rules for a client (paused). Rules that already exist (by name) are left alone. */
export async function installRecommendedRules(actor: Actor, clientId: string) {
  const ctx = await requirePermission(actor, clientId, "automation.manage");
  let created = 0;
  for (const preset of RECOMMENDED_RULES) {
    const payload = validate(preset);
    const exists = await prisma().automationRule.findFirst({
      where: { clientId, name: payload.name, archivedAt: null },
      select: { id: true },
    });
    if (exists) continue;
    await prisma().$transaction(async (tx) => {
      const rule = await tx.automationRule.create({
        data: {
          ...payloadData(payload),
          agencyId: ctx.agencyId,
          clientId,
          trigger: "schedule",
          status: "paused",
          createdById: actor.userId,
        },
        select: { id: true },
      });
      await recordAudit(tx, {
        actorUserId: actor.userId,
        agencyId: ctx.agencyId,
        clientId,
        action: "automation.rule_created",
        entityType: "automation_rule",
        entityId: rule.id,
        after: { name: payload.name, kind: payload.kind, recommended: true },
      });
    });
    created++;
  }
  return { created, skipped: RECOMMENDED_RULES.length - created };
}

// ---- Agency templates -----------------------------------------------------------------------------------------------

export async function listTemplates(actor: Actor) {
  const agencies = await listAgenciesWith(actor, "agency.manage");
  if (agencies.length === 0) return { agencyId: null as string | null, templates: [] };
  const agencyId = agencies[0]!.id;
  const templates = await prisma().automationRuleTemplate.findMany({
    where: { agencyId, archivedAt: null },
    orderBy: { name: "asc" },
    include: { _count: { select: { rules: true } } },
  });
  return { agencyId, templates };
}

export async function saveTemplate(
  actor: Actor,
  input: { agencyId: string; templateId?: string; enabled?: boolean; payload: RulePayload },
) {
  await requireAgencyPermission(actor, input.agencyId, "agency.manage");
  const payload = validate(input.payload);
  const data = {
    ...payloadData(payload),
    status: (input.enabled ? "active" : "paused") as "active" | "paused",
  };
  try {
    return await prisma().$transaction(async (tx) => {
      let id = input.templateId;
      if (id) {
        const own = await tx.automationRuleTemplate.findFirst({
          where: { id, agencyId: input.agencyId },
          select: { id: true },
        });
        if (!own) throw new NotFoundError("Template not found");
        await tx.automationRuleTemplate.update({ where: { id }, data });
      } else {
        id = (
          await tx.automationRuleTemplate.create({
            data: { ...data, agencyId: input.agencyId, createdById: actor.userId },
            select: { id: true },
          })
        ).id;
      }
      await recordAudit(tx, {
        actorUserId: actor.userId,
        agencyId: input.agencyId,
        clientId: null,
        action: input.templateId ? "automation.template_updated" : "automation.template_created",
        entityType: "automation_rule_template",
        entityId: id,
        after: { name: payload.name, kind: payload.kind },
      });
      return { id };
    });
  } catch (error) {
    if (isUnique(error)) throw new ConflictError("A template with this name already exists");
    throw error;
  }
}

/**
 * Create or update one rule per ACTIVE client of the agency from a template. A client's own edits win:
 * rules marked `customized` are never overwritten. Returns what happened per client.
 */
export async function applyTemplate(actor: Actor, templateId: string) {
  const t = await prisma().automationRuleTemplate.findFirst({
    where: { id: templateId, archivedAt: null },
  });
  if (!t) throw new NotFoundError("Template not found");
  await requireAgencyPermission(actor, t.agencyId, "agency.manage");
  const clients = await prisma().client.findMany({
    where: { agencyId: t.agencyId, status: "active" },
    select: { id: true },
  });
  const result = { created: 0, updated: 0, keptCustomized: 0 };
  const fields = {
    name: t.name,
    description: t.description,
    kind: t.kind,
    severity: t.severity,
    intervalMinutes: t.intervalMinutes,
    config: t.config as Prisma.InputJsonObject,
    assignment: t.assignment as Prisma.InputJsonObject,
    taskTemplate: t.taskTemplate as Prisma.InputJsonObject,
    duePolicy: t.duePolicy as Prisma.InputJsonObject,
    notifyPolicy: t.notifyPolicy as Prisma.InputJsonObject,
    cooldown: t.cooldown as Prisma.InputJsonObject,
  };
  for (const c of clients) {
    await prisma().$transaction(async (tx) => {
      const existing = await tx.automationRule.findFirst({
        where: { clientId: c.id, templateId: t.id, archivedAt: null },
        select: { id: true, customized: true },
      });
      if (existing?.customized) {
        result.keptCustomized++;
        return;
      }
      if (existing) {
        await tx.automationRule.update({
          where: { id: existing.id },
          data: {
            ...fields,
            status: t.status === "active" ? "active" : "paused",
            version: { increment: 1 },
          },
        });
        result.updated++;
      } else {
        try {
          await tx.automationRule.create({
            data: {
              ...fields,
              agencyId: t.agencyId,
              clientId: c.id,
              templateId: t.id,
              trigger: "schedule",
              status: t.status === "active" ? "active" : "paused",
              createdById: actor.userId,
            },
          });
          result.created++;
        } catch (error) {
          if (!isUnique(error)) throw error; // the client already has a rule with this name: leave it
        }
      }
    });
  }
  await prisma().$transaction((tx) =>
    recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: t.agencyId,
      clientId: null,
      action: "automation.template_applied",
      entityType: "automation_rule_template",
      entityId: t.id,
      after: result,
    }),
  );
  return result;
}

// ---- Executions and findings ---------------------------------------------------------------------------------------------

export async function listRuns(
  actor: Actor,
  f: { clientId?: string; ruleId?: string; status?: string; page?: number } = {},
) {
  const map = await getAccessMap(actor);
  const allowed = clientIdsWith(map, "automation.view");
  const ids = f.clientId ? allowed.filter((c) => c === f.clientId) : allowed;
  const page = clampPage(f.page);
  if (ids.length === 0) return paged([], 0, page);
  const where: Prisma.AutomationRunWhereInput = {
    clientId: { in: ids },
    ...(f.ruleId ? { ruleId: f.ruleId } : {}),
    ...(f.status ? { status: f.status as never } : {}),
    rule: { kind: { not: null } },
  };
  const db = forClients(ids);
  const [rows, total] = await Promise.all([
    db.automationRun.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        status: true,
        trigger: true,
        attempt: true,
        error: true,
        summary: true,
        nextAttemptAt: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true,
        rule: { select: { id: true, name: true, kind: true } },
        client: { select: { name: true } },
      },
    }),
    db.automationRun.count({ where }),
  ]);
  return paged(rows, total, page);
}

export async function getRun(actor: Actor, runId: string) {
  const found = await prisma().automationRun.findUnique({
    where: { id: runId },
    select: { clientId: true },
  });
  if (!found) throw new NotFoundError("Execution not found");
  const ctx = await requirePermission(actor, found.clientId, "automation.view");
  return ctx.db.automationRun.findFirstOrThrow({
    where: { id: runId },
    include: {
      rule: { select: { id: true, name: true, kind: true } },
      client: { select: { name: true } },
      automationStepRuns: { orderBy: [{ attempt: "asc" }, { stepIndex: "asc" }] },
    },
  });
}

export async function listFindings(
  actor: Actor,
  f: { clientId?: string; status?: string; kind?: string; page?: number } = {},
) {
  const map = await getAccessMap(actor);
  const allowed = clientIdsWith(map, "automation.view");
  const ids = f.clientId ? allowed.filter((c) => c === f.clientId) : allowed;
  const page = clampPage(f.page);
  if (ids.length === 0) return paged([], 0, page);
  const where: Prisma.AutomationFindingWhereInput = {
    clientId: { in: ids },
    status: f.status === "resolved" ? "resolved" : f.status === "all" ? undefined : "open",
    ...((RULE_KINDS as readonly string[]).includes(f.kind ?? "") ? { kind: f.kind as never } : {}),
  };
  const db = forClients(ids);
  const [rows, total] = await Promise.all([
    db.automationFinding.findMany({
      where,
      orderBy: [{ status: "asc" }, { lastSeenAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        client: { select: { name: true } },
        rule: { select: { name: true } },
        task: {
          select: { id: true, title: true, status: true, assignee: { select: { name: true } } },
        },
      },
    }),
    db.automationFinding.count({ where }),
  ]);
  return paged(rows, total, page);
}
