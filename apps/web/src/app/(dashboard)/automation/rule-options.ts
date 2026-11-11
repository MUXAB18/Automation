import {
  AUTOMATION_ROLE_KEYS,
  RECOMMENDED_RULES,
  configSchemas,
  parseRulePayload,
  type RuleKind,
} from "@automation/db";
import type { RuleFormValues } from "./rule-form";

export const roleOptions = AUTOMATION_ROLE_KEYS.map((value) => ({
  value,
  label: value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
}));

/** The recommended rule of a type, normalised, as the starting point of a new rule. */
export function defaultsFor(kind: RuleKind): RuleFormValues {
  const preset = RECOMMENDED_RULES.find((r) => r.kind === kind)!;
  return toValues(parseRulePayload(preset));
}

/** Stored rule JSON -> form values, filling anything missing from the type's defaults. */
export function toValues(
  p: ReturnType<typeof parseRulePayload>,
  extra: { projectId?: string | null; enabled?: boolean } = {},
): RuleFormValues {
  return {
    name: p.name,
    description: p.description,
    kind: p.kind,
    severity: p.severity,
    intervalMinutes: p.intervalMinutes,
    config: configSchemas[p.kind].parse(p.config) as Record<string, unknown>,
    assignment: p.assignment,
    taskTemplate: p.taskTemplate,
    duePolicy: p.duePolicy,
    notifyPolicy: p.notifyPolicy,
    cooldown: p.cooldown,
    ...extra,
  };
}
