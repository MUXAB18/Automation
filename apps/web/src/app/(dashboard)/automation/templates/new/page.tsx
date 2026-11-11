import { notFound } from "next/navigation";
import Link from "next/link";
import {
  KIND_DESCRIPTION,
  KIND_LABEL,
  NOTIFY_ONLY_KINDS,
  RULE_KINDS,
  listTemplates,
  type RuleKind,
} from "@automation/db";
import { PageHeader } from "@/components/page-header";
import { oneOf, type RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";
import { createTemplateAction } from "../../actions";
import { defaultsFor, roleOptions } from "../../rule-options";
import { RuleForm } from "../../rule-form";

export const metadata = { title: "New automation template" };

export default async function NewTemplatePage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const actor = await requireActor();
  const { agencyId } = await listTemplates(actor);
  if (!agencyId) notFound();
  const kind = oneOf((await searchParams).kind, RULE_KINDS);
  const crumbs = [
    { label: "Automation", href: "/automation" },
    { label: "Agency templates", href: "/automation/templates" },
    { label: "New template" },
  ];
  if (!kind)
    return (
      <>
        <PageHeader
          title="New template"
          description="What should the rule watch for?"
          breadcrumbs={crumbs}
        />
        <div className="grid gap-4 md:grid-cols-2">
          {RULE_KINDS.map((k) => (
            <Link
              key={k}
              href={`/automation/templates/new?kind=${k}`}
              className="rounded-xl border border-border bg-card p-5 shadow-card transition-colors hover:border-primary"
            >
              <p className="font-semibold">{KIND_LABEL[k]}</p>
              <p className="mt-1 text-sm text-muted-foreground">{KIND_DESCRIPTION[k]}</p>
            </Link>
          ))}
        </div>
      </>
    );
  return (
    <>
      <PageHeader title="New template" description={KIND_DESCRIPTION[kind]} breadcrumbs={crumbs} />
      <RuleForm
        mode="create"
        action={createTemplateAction}
        ownerKind="agency"
        ownerId={agencyId}
        ownerName="All clients"
        kindLabel={KIND_LABEL[kind as RuleKind]}
        values={defaultsFor(kind)}
        roleOptions={roleOptions}
        projects={[]}
        notifyOnly={NOTIFY_ONLY_KINDS.includes(kind)}
      />
    </>
  );
}
