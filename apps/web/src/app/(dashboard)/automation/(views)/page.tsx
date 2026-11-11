import Link from "next/link";
import { Workflow } from "lucide-react";
import { KIND_LABEL, listRules, type RuleKind } from "@automation/db";
import { DataTable, formatDate } from "@/components/data-table";
import { Pagination } from "@/components/pagination";
import { EmptyState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getScope } from "@/lib/scope";
import { flat, page, type RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";
import { installRecommendedAction } from "../actions";
import { InstallRecommended, RuleActions } from "../rule-actions";

export const metadata = { title: "Automation rules" };

export default async function AutomationRulesPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const actor = await requireActor();
  const raw = await searchParams;
  const scope = await getScope(actor);
  const result = await listRules(actor, { clientId: scope.clientId, page: page(raw.page) });
  const newHref = `/automation/new${scope.clientId ? `?client=${scope.clientId}` : ""}`;

  return (
    <>
      {result.canManage ? (
        <div className="mb-4 flex flex-wrap justify-end gap-2">
          {scope.clientId ? (
            <InstallRecommended clientId={scope.clientId} action={installRecommendedAction} />
          ) : null}
          <Button asChild>
            <Link href={newHref}>New rule</Link>
          </Button>
        </div>
      ) : null}
      {result.total === 0 ? (
        <EmptyState
          icon={Workflow}
          title="No automation rules yet"
          description={
            result.canManage
              ? scope.clientId
                ? "Add the seven recommended rules (they start paused) or create your own."
                : "Choose a client in the header to add the recommended rules, or create a rule."
              : "Rules created for a client will be listed here with their last run."
          }
        />
      ) : (
        <>
          <DataTable
            caption="Automation rules"
            rows={result.rows}
            columns={[
              {
                key: "name",
                header: "Rule",
                cell: (r) => (
                  <div>
                    <span className="font-medium">{r.name}</span>
                    <p className="text-xs text-muted-foreground">
                      {r.kind ? KIND_LABEL[r.kind as RuleKind] : ""}
                      {r.template
                        ? ` · from template "${r.template.name}"${r.customized ? " (edited)" : ""}`
                        : ""}
                      {r.project ? ` · ${r.project.name}` : ""}
                    </p>
                  </div>
                ),
              },
              { key: "client", header: "Client", hideOnMobile: true, cell: (r) => r.client.name },
              {
                key: "severity",
                header: "Severity",
                hideOnMobile: true,
                cell: (r) => <StatusBadge kind="severity" status={r.severity} />,
              },
              {
                key: "status",
                header: "Status",
                cell: (r) => <StatusBadge kind="rule" status={r.status} />,
              },
              {
                key: "last",
                header: "Last run",
                hideOnMobile: true,
                cell: (r) =>
                  r.lastRun ? (
                    <div className="flex flex-col gap-1">
                      <span className="flex items-center gap-2">
                        <StatusBadge kind="run" status={r.lastRun.status} />
                        <span className="text-xs text-muted-foreground">
                          {formatDate(r.lastRun.createdAt)}
                        </span>
                      </span>
                      {r.lastRun.error ? (
                        <span className="max-w-xs text-xs text-destructive">{r.lastRun.error}</span>
                      ) : null}
                    </div>
                  ) : (
                    "Never"
                  ),
              },
              {
                key: "findings",
                header: "Open findings",
                hideOnMobile: true,
                cell: (r) =>
                  r.openFindings > 0 ? <Badge tone="warning">{r.openFindings}</Badge> : "0",
              },
              {
                key: "actions",
                header: "Actions",
                align: "right",
                cell: (r) =>
                  r.canManage ? <RuleActions id={r.id} active={r.status === "active"} /> : null,
              },
            ]}
          />
          <Pagination
            page={result.page}
            pageCount={result.pageCount}
            total={result.total}
            searchParams={flat(raw)}
            basePath="/automation"
          />
        </>
      )}
    </>
  );
}
