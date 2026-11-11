import { configSchemas, type RuleKind } from "@automation/db";
import { text } from "./form-input";

/**
 * Browser form fields -> rule payload. Checkboxes are sent only when ticked, so every boolean is read
 * explicitly (Zod would turn the string "false" into true). The service validates everything again.
 */
const flag = (formData: FormData, key: string) => formData.get(key) === "on";

/** Number and boolean settings are typed from the rule type's own defaults, so no per-rule form code is needed. */
function configInput(kind: RuleKind, formData: FormData) {
  const defaults = configSchemas[kind].parse({}) as Record<string, unknown>;
  const config: Record<string, unknown> = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    if (typeof fallback === "boolean") config[key] = flag(formData, `config.${key}`);
    else config[key] = text(formData, `config.${key}`) ?? fallback;
  }
  return config;
}

export function ruleInput(formData: FormData) {
  const kind = (text(formData, "kind") ?? "") as RuleKind;
  const labels = (text(formData, "task.labels") ?? "")
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    projectId: text(formData, "projectId") || null,
    enabled: flag(formData, "enabled"),
    payload: {
      name: text(formData, "name") ?? "",
      description: text(formData, "description") || undefined,
      kind,
      severity: text(formData, "severity") ?? "medium",
      intervalMinutes: text(formData, "intervalMinutes") ?? "60",
      config: kind in configSchemas ? configInput(kind, formData) : {},
      assignment: {
        mode: text(formData, "assignment.mode") ?? "role",
        roleKey: text(formData, "assignment.roleKey") ?? "seo_specialist",
        strategy: text(formData, "assignment.strategy") ?? "least_loaded",
      },
      taskTemplate: {
        createTask: !flag(formData, "task.recordOnly"),
        title: text(formData, "task.title") ?? "",
        description: text(formData, "task.description") ?? "",
        acceptanceCriteria: text(formData, "task.acceptanceCriteria") ?? "",
        type: text(formData, "task.type") ?? "seo_fix",
        labels,
      },
      duePolicy: {
        mode: text(formData, "due.mode") ?? "by_severity",
        days: text(formData, "due.days") ?? "7",
        businessDays: flag(formData, "due.businessDays"),
      },
      notifyPolicy: {
        enabled: flag(formData, "notify.enabled"),
        assignee: flag(formData, "notify.assignee"),
        managers: flag(formData, "notify.managers"),
        reviewers: flag(formData, "notify.reviewers"),
        reNotifyHours: text(formData, "notify.reNotifyHours") ?? "0",
      },
      cooldown: {
        hours: text(formData, "cooldown.hours") ?? "72",
        maxTasksPerRun: text(formData, "cooldown.maxTasksPerRun") ?? "10",
        maxOpenTasks: text(formData, "cooldown.maxOpenTasks") ?? "50",
      },
    },
  } as never as {
    projectId: string | null;
    enabled: boolean;
    payload: Parameters<typeof import("@automation/db").createRule>[1]["payload"];
  };
}
