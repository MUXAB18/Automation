import { KIND_LABEL, getRun, type RuleKind } from "@automation/db";
import { formatDate } from "@/components/data-table";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { orNotFound } from "@/lib/guard";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Execution" };

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const run = await orNotFound(getRun(actor, id));
  const summary = run.summary as Record<string, unknown>;

  return (
    <>
      <PageHeader
        title={run.rule.name}
        description={`${run.rule.kind ? KIND_LABEL[run.rule.kind as RuleKind] : "Rule"} · ${run.client.name}`}
        breadcrumbs={[
          { label: "Automation", href: "/automation" },
          { label: "Execution history", href: "/automation/runs" },
          { label: "Execution" },
        ]}
        badges={<StatusBadge kind="run" status={run.status} />}
      />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <p>
              <span className="text-muted-foreground">Started by:</span>{" "}
              <span className="capitalize">{run.trigger}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Attempt:</span> {run.attempt}
            </p>
            <p>
              <span className="text-muted-foreground">Started:</span>{" "}
              {formatDate(run.startedAt) ?? "Not yet"}
            </p>
            <p>
              <span className="text-muted-foreground">Finished:</span>{" "}
              {formatDate(run.finishedAt) ?? "Not yet"}
            </p>
            {run.nextAttemptAt ? (
              <p className="sm:col-span-2">
                <span className="text-muted-foreground">Retry planned:</span>{" "}
                {formatDate(run.nextAttemptAt)}
              </p>
            ) : null}
            {run.error ? <p className="text-destructive sm:col-span-4">{run.error}</p> : null}
            {Object.entries(summary).map(([k, v]) => (
              <p key={k}>
                <span className="text-muted-foreground">
                  {k.replace(/([A-Z])/g, " $1").toLowerCase()}:
                </span>{" "}
                {String(v)}
              </p>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Steps</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              caption="Steps of this execution"
              rows={run.automationStepRuns}
              columns={[
                { key: "n", header: "#", cell: (s) => s.stepIndex },
                {
                  key: "action",
                  header: "Step",
                  cell: (s) => <span className="font-medium">{s.action.replace(/_/g, " ")}</span>,
                },
                {
                  key: "key",
                  header: "Item",
                  hideOnMobile: true,
                  cell: (s) => (
                    <span className="break-all text-xs text-muted-foreground">{s.stepKey}</span>
                  ),
                },
                {
                  key: "status",
                  header: "Status",
                  cell: (s) => <StatusBadge kind="run" status={s.status} />,
                },
                { key: "attempt", header: "Attempt", hideOnMobile: true, cell: (s) => s.attempt },
                {
                  key: "output",
                  header: "Details",
                  cell: (s) => (
                    <span className="break-words text-xs text-muted-foreground">
                      {s.error ?? (s.output ? JSON.stringify(s.output).slice(0, 220) : "")}
                    </span>
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
