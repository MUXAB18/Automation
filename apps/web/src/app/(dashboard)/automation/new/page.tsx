import Link from "next/link";
import { notFound } from "next/navigation";
import {
  KIND_DESCRIPTION,
  KIND_LABEL,
  NOTIFY_ONLY_KINDS,
  RULE_KINDS,
  listProjectOptions,
  listRules,
  type RuleKind,
} from "@automation/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getScope } from "@/lib/scope";
import { oneOf, str, type RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";
import { createRuleAction } from "../actions";
import { defaultsFor, roleOptions } from "../rule-options";
import { RuleForm } from "../rule-form";

export const metadata = { title: "New automation rule" };

export default async function NewRulePage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const actor = await requireActor();
  const raw = await searchParams;
  const scope = await getScope(actor);
  const crumbs = [{ label: "Automation", href: "/automation" }, { label: "New rule" }];
  // Only clients where the person may manage rules are offered; the service checks again on save.
  const manageable = (await listRules(actor, {})).canManage;
  if (!manageable) notFound();

  const clientId =
    str(raw.client) ??
    scope.clientId ??
    (scope.clients.length === 1 ? scope.clients[0]!.id : undefined);
  const client = scope.clients.find((c) => c.id === clientId);
  if (!client) {
    return (
      <>
        <PageHeader
          title="New rule"
          description="Which client is this rule for?"
          breadcrumbs={crumbs}
        />
        <Card>
          <CardContent className="pt-6">
            <ul className="divide-y divide-border">
              {scope.clients.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/automation/new?client=${c.id}`}
                    className="flex items-center justify-between py-3 text-sm font-medium hover:underline"
                  >
                    {c.name}
                    <span aria-hidden className="text-muted-foreground">
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </>
    );
  }

  const kind = oneOf(raw.kind, RULE_KINDS);
  if (!kind) {
    return (
      <>
        <PageHeader
          title="New rule"
          description={`What should the rule watch for ${client.name}?`}
          breadcrumbs={crumbs}
        />
        <div className="grid gap-4 md:grid-cols-2">
          {RULE_KINDS.map((k) => (
            <Link
              key={k}
              href={`/automation/new?client=${client.id}&kind=${k}`}
              className="rounded-xl border border-border bg-card p-5 shadow-card transition-colors hover:border-primary"
            >
              <p className="font-semibold">{KIND_LABEL[k]}</p>
              <p className="mt-1 text-sm text-muted-foreground">{KIND_DESCRIPTION[k]}</p>
            </Link>
          ))}
        </div>
      </>
    );
  }

  const projects = await listProjectOptions(actor, client.id);
  return (
    <>
      <PageHeader title="New rule" description={KIND_DESCRIPTION[kind]} breadcrumbs={crumbs} />
      <RuleForm
        mode="create"
        action={createRuleAction}
        ownerKind="client"
        ownerId={client.id}
        ownerName={client.name}
        kindLabel={KIND_LABEL[kind as RuleKind]}
        values={defaultsFor(kind)}
        roleOptions={roleOptions}
        projects={projects}
        notifyOnly={NOTIFY_ONLY_KINDS.includes(kind)}
      />
    </>
  );
}
