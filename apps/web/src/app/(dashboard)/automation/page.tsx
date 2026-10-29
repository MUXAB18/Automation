import { Workflow } from "lucide-react";
import { listAutomationRules } from "@automation/db";
import { DataTable, formatDate } from "@/components/data-table";
import { ClearFilters, FilterBar, FilterSelect } from "@/components/filters";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { ScopeBadge } from "@/components/scope-badge";
import { DevelopmentNotice, EmptyState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { getScope } from "@/lib/scope";
import { requireSection } from "@/lib/sections";
import { flat, oneOf, page, type RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Automation Rules" };

const STATUSES = ["draft", "active", "paused"] as const;

export default async function AutomationPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const actor = await requireActor();
  await requireSection(actor, "automation");
  const raw = await searchParams;
  const scope = await getScope(actor);
  const status = oneOf(raw.status, STATUSES);
  const result = await listAutomationRules(actor, {
    clientId: scope.clientId,
    status,
    page: page(raw.page),
  });

  return (
    <>
      <PageHeader
        title="Automation Rules"
        description="Rules that run work for each client on a schedule or when something happens."
        breadcrumbs={[{ label: "Automation Rules" }]}
        badges={<ScopeBadge scope={scope} />}
      />
      <DevelopmentNotice>
        Creating and running rules is coming next. Rules that publish or change a website will
        always wait for approval.
      </DevelopmentNotice>
      <FilterBar>
        <FilterSelect
          name="status"
          label="Filter by status"
          allLabel="All statuses"
          options={STATUSES.map((s) => ({ value: s, label: s }))}
        />
        <ClearFilters names={["status"]} />
      </FilterBar>
      {result.total === 0 ? (
        <EmptyState
          icon={Workflow}
          title={status ? "No rules with this status" : "No automation rules yet"}
          description="Rules you create for a client will be listed here with their last run."
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
                cell: (r) => <span className="font-medium">{r.name}</span>,
              },
              { key: "client", header: "Client", hideOnMobile: true, cell: (r) => r.client.name },
              {
                key: "trigger",
                header: "Trigger",
                cell: (r) => <span className="capitalize">{r.trigger}</span>,
              },
              {
                key: "approval",
                header: "Approval",
                hideOnMobile: true,
                cell: (r) =>
                  r.requiresApproval ? (
                    <Badge tone="primary">required</Badge>
                  ) : (
                    <Badge>not required</Badge>
                  ),
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
                cell: (r) => formatDate(r.lastRunAt) ?? "Never",
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
