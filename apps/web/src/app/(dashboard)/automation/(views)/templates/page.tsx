import Link from "next/link";
import { notFound } from "next/navigation";
import { LayoutTemplate } from "lucide-react";
import { KIND_LABEL, listTemplates, type RuleKind } from "@automation/db";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { requireActor } from "@/lib/session";
import { applyTemplateAction } from "../../actions";
import { ApplyTemplate } from "../../rule-actions";

export const metadata = { title: "Automation templates" };

export default async function TemplatesPage() {
  const actor = await requireActor();
  const { agencyId, templates } = await listTemplates(actor);
  if (!agencyId) notFound();
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          A template is one rule defined once for the agency. Applying it creates the rule for every
          active client; clients can then edit their copy.
        </p>
        <Button asChild>
          <Link href="/automation/templates/new">New template</Link>
        </Button>
      </div>
      {templates.length === 0 ? (
        <EmptyState
          icon={LayoutTemplate}
          title="No templates yet"
          description="Create a template to roll the same rule out to all clients."
        />
      ) : (
        <DataTable
          caption="Agency rule templates"
          rows={templates}
          columns={[
            {
              key: "name",
              header: "Template",
              cell: (t) => <span className="font-medium">{t.name}</span>,
            },
            {
              key: "kind",
              header: "Rule type",
              hideOnMobile: true,
              cell: (t) => KIND_LABEL[t.kind as RuleKind],
            },
            {
              key: "status",
              header: "Rules start",
              cell: (t) => <StatusBadge kind="rule" status={t.status} />,
            },
            {
              key: "used",
              header: "Client rules",
              hideOnMobile: true,
              cell: (t) => t._count.rules,
            },
            {
              key: "actions",
              header: "Actions",
              align: "right",
              cell: (t) => <ApplyTemplate id={t.id} action={applyTemplateAction} />,
            },
          ]}
        />
      )}
    </>
  );
}
