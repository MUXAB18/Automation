import Link from "next/link";
import { Sparkles } from "lucide-react";
import {
  AI_TASKS,
  TASK_LABEL,
  getAiUsage,
  listAiJobs,
  listApprovedSources,
  listContentOptions,
  listProjectOptions,
  type AiTask,
} from "@automation/db";
import { DataTable, formatDate } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { ScopeBadge } from "@/components/scope-badge";
import { EmptyState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAiConfig } from "@/lib/ai-config";
import { getScope } from "@/lib/scope";
import { requireSection } from "@/lib/sections";
import { flat, oneOf, page, type RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";
import { requestGenerationAction } from "./actions";
import { GenerateForm } from "./generate-form";

export const metadata = { title: "AI studio" };

export default async function AiStudioPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const actor = await requireActor();
  await requireSection(actor, "content");
  const raw = await searchParams;
  const scope = await getScope(actor);
  const config = getAiConfig();
  const jobs = await listAiJobs(actor, { clientId: scope.clientId, page: page(raw.page) });
  const initial = oneOf(raw.task, AI_TASKS) as AiTask | undefined;

  let form = null;
  if (scope.clientId) {
    const client = scope.clients.find((c) => c.id === scope.clientId)!;
    const [projects, sources, contentOptions, usage] = await Promise.all([
      listProjectOptions(actor, scope.clientId),
      listApprovedSources(actor, scope.clientId).catch(() => null),
      listContentOptions(actor, scope.clientId).catch(() => []),
      getAiUsage(scope.clientId, config),
    ]);
    form = sources ? (
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>New generation</CardTitle>
          </CardHeader>
          <CardContent>
            <GenerateForm
              action={requestGenerationAction}
              clientId={client.id}
              clientName={client.name}
              tasks={[...AI_TASKS]}
              projects={projects.map((p) => ({ id: p.id, name: p.name }))}
              sources={sources.map((s) => ({ id: s.id, title: s.title }))}
              contentOptions={contentOptions}
              initialTask={initial}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>This month</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p>
              <span className="text-muted-foreground">Requests:</span> {usage.requests} of{" "}
              {usage.maxRequests}
            </p>
            <p>
              <span className="text-muted-foreground">Estimated cost:</span> $
              {(Number(usage.costMicros) / 1e6).toFixed(2)}
              {usage.maxCostMicros > 0n
                ? ` of $${(Number(usage.maxCostMicros) / 1e6).toFixed(2)}`
                : " (no cost cap)"}
            </p>
            <p>
              <span className="text-muted-foreground">Provider:</span> {config.provider} ·{" "}
              {config.model}
            </p>
            {config.provider === "mock" ? (
              <p className="text-xs text-muted-foreground">
                The development mock returns placeholder text. Set AI_PROVIDER to use a real model.
              </p>
            ) : null}
            <Button variant="outline" size="sm" asChild>
              <Link href="/content/ai/settings">Approved sources and limits</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    ) : null;
  }

  return (
    <>
      <PageHeader
        title="AI studio"
        description="Drafts, briefs and suggestions for the selected client. Everything generated is a draft that needs human review."
        breadcrumbs={[{ label: "Content", href: "/content" }, { label: "AI studio" }]}
        badges={<ScopeBadge scope={scope} />}
      />
      {form ?? (
        <p className="mb-6 text-sm text-muted-foreground">
          Choose a client in the header to start a generation. Past generations are listed below.
        </p>
      )}
      <h2 className="mb-3 mt-8 text-lg font-semibold">Generations</h2>
      {jobs.total === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Nothing generated yet"
          description="Each request is recorded here with its provider, model, cost and result."
        />
      ) : (
        <>
          <DataTable
            caption="AI generations"
            rows={jobs.rows}
            rowHref={(j) => `/content/ai/${j.id}`}
            columns={[
              { key: "task", header: "Type", cell: (j) => TASK_LABEL[j.task as AiTask] ?? j.task },
              { key: "client", header: "Client", hideOnMobile: true, cell: (j) => j.client.name },
              {
                key: "status",
                header: "Status",
                cell: (j) => <StatusBadge kind="run" status={j.status} />,
              },
              {
                key: "model",
                header: "Model",
                hideOnMobile: true,
                cell: (j) => `${j.provider} · ${j.model}`,
              },
              {
                key: "by",
                header: "By",
                hideOnMobile: true,
                cell: (j) => j.requestedBy?.name ?? "System",
              },
              {
                key: "when",
                header: "Requested",
                hideOnMobile: true,
                cell: (j) => formatDate(j.createdAt),
              },
            ]}
          />
          <Pagination
            page={jobs.page}
            pageCount={jobs.pageCount}
            total={jobs.total}
            searchParams={flat(raw)}
            basePath="/content/ai"
          />
        </>
      )}
    </>
  );
}
