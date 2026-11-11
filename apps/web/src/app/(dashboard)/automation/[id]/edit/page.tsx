import { notFound } from "next/navigation";
import {
  KIND_LABEL,
  NOTIFY_ONLY_KINDS,
  getRule,
  listProjectOptions,
  parseRulePayload,
  type RuleKind,
} from "@automation/db";
import { PageHeader } from "@/components/page-header";
import { orNotFound } from "@/lib/guard";
import { requireActor } from "@/lib/session";
import { updateRuleAction } from "../../actions";
import { roleOptions, toValues } from "../../rule-options";
import { RuleForm } from "../../rule-form";

export const metadata = { title: "Edit automation rule" };

export default async function EditRulePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const { rule, canManage } = await orNotFound(getRule(actor, id));
  if (!canManage || !rule.kind) notFound();
  const projects = await listProjectOptions(actor, rule.clientId);
  const payload = parseRulePayload({
    name: rule.name,
    description: rule.description ?? undefined,
    kind: rule.kind,
    severity: rule.severity,
    intervalMinutes: rule.intervalMinutes,
    config: rule.config,
    assignment: rule.assignment,
    taskTemplate: rule.taskTemplate,
    duePolicy: rule.duePolicy,
    notifyPolicy: rule.notifyPolicy,
    cooldown: rule.cooldown,
  });
  return (
    <>
      <PageHeader
        title="Edit rule"
        description={
          rule.template
            ? `Created from the agency template "${rule.template.name}". Saving makes this copy your own: later template changes will not overwrite it.`
            : undefined
        }
        breadcrumbs={[{ label: "Automation", href: "/automation" }, { label: rule.name }]}
      />
      <RuleForm
        mode="edit"
        action={updateRuleAction.bind(null, rule.id)}
        ownerKind="client"
        ownerName={rule.client.name}
        kindLabel={KIND_LABEL[rule.kind as RuleKind]}
        values={toValues(payload, { projectId: rule.projectId })}
        roleOptions={roleOptions}
        projects={projects}
        notifyOnly={NOTIFY_ONLY_KINDS.includes(rule.kind as RuleKind)}
      />
    </>
  );
}
