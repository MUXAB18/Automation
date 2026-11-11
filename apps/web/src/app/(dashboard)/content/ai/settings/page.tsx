import { notFound } from "next/navigation";
import { getAiUsage, listApprovedSources, requirePermission } from "@automation/db";
import { PageHeader } from "@/components/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAiConfig } from "@/lib/ai-config";
import { orNotFound } from "@/lib/guard";
import { getScope } from "@/lib/scope";
import { requireActor } from "@/lib/session";
import { addSourceAction, archiveSourceAction, setLimitAction } from "../actions";
import { LimitForm, SourceForm } from "./forms";

export const metadata = { title: "AI sources and limits" };

export default async function AiSettingsPage() {
  const actor = await requireActor();
  const scope = await getScope(actor);
  if (!scope.clientId) notFound();
  const client = scope.clients.find((c) => c.id === scope.clientId)!;
  const config = getAiConfig();
  const [sources, usage] = await Promise.all([
    orNotFound(listApprovedSources(actor, client.id)),
    getAiUsage(client.id, config),
  ]);
  const canManage = await requirePermission(actor, client.id, "ai.manage")
    .then(() => true)
    .catch(() => false);
  return (
    <>
      <PageHeader
        title="AI sources and limits"
        description={`What the model may use for ${client.name}, and how much.`}
        breadcrumbs={[
          { label: "Content", href: "/content" },
          { label: "AI studio", href: "/content/ai" },
          { label: "Sources and limits" },
        ]}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Approved source material</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              Only the published brand guideline and the sources listed here are ever given to the
              model for this client. Add facts you have checked.
            </p>
            {sources.length === 0 ? (
              <p className="text-sm">None yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {sources.map((s) => (
                  <li key={s.id} className="flex items-start justify-between gap-3 py-3 text-sm">
                    <div>
                      <p className="font-medium">{s.title}</p>
                      <p className="line-clamp-2 text-muted-foreground">{s.body}</p>
                      <p className="text-xs text-muted-foreground">
                        Approved by {s.approvedBy.name}
                      </p>
                    </div>
                    {canManage ? (
                      <ConfirmDialog
                        triggerLabel="Remove"
                        triggerVariant="ghost"
                        title="Remove this source?"
                        description="The model will no longer see it. Past generations keep their record."
                        confirmLabel="Remove"
                        action={archiveSourceAction}
                        fields={{ sourceId: s.id }}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {canManage ? (
              <SourceForm action={addSourceAction} clientId={client.id} />
            ) : (
              <p className="text-xs text-muted-foreground">Only AI managers can approve sources.</p>
            )}
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Monthly limits</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm">
              Used this month: {usage.requests} requests, $
              {(Number(usage.costMicros) / 1e6).toFixed(2)} estimated.
            </p>
            {canManage ? (
              <LimitForm
                action={setLimitAction}
                clientId={client.id}
                requests={usage.maxRequests}
                costUsd={Number(usage.maxCostMicros) / 1e6}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Limit: {usage.maxRequests} requests.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
