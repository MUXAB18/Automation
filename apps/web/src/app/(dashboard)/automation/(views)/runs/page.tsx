import { History } from "lucide-react";
import { KIND_LABEL, listRuns, type RuleKind } from "@automation/db";
import { DataTable, formatDate } from "@/components/data-table";
import { ClearFilters, FilterBar, FilterSelect } from "@/components/filters";
import { Pagination } from "@/components/pagination";
import { EmptyState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { getScope } from "@/lib/scope";
import { flat, oneOf, page, type RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Execution history" };

const STATUSES = ["queued", "running", "succeeded", "failed", "skipped"] as const;

type Summary = {
  findings?: number;
  tasksCreated?: number;
  deduped?: number;
  notified?: number;
  skippedReason?: string;
};

export default async function RunsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const actor = await requireActor();
  const raw = await searchParams;
  const scope = await getScope(actor);
  const status = oneOf(raw.status, STATUSES);
  const result = await listRuns(actor, { clientId: scope.clientId, status, page: page(raw.page) });

  return (
    <>
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
          icon={History}
          title="No executions yet"
          description="Every time a rule runs, what it checked and did is recorded here."
        />
      ) : (
        <>
          <DataTable
            caption="Automation executions"
            rows={result.rows}
            rowHref={(r) => `/automation/runs/${r.id}`}
            columns={[
              {
                key: "rule",
                header: "Rule",
                cell: (r) => (
                  <div>
                    <span className="font-medium">{r.rule.name}</span>
                    <p className="text-xs text-muted-foreground">
                      {r.rule.kind ? KIND_LABEL[r.rule.kind as RuleKind] : ""}
                    </p>
                  </div>
                ),
              },
              { key: "client", header: "Client", hideOnMobile: true, cell: (r) => r.client.name },
              {
                key: "status",
                header: "Status",
                cell: (r) => <StatusBadge kind="run" status={r.status} />,
              },
              {
                key: "trigger",
                header: "Started by",
                hideOnMobile: true,
                cell: (r) => <span className="capitalize">{r.trigger}</span>,
              },
              {
                key: "result",
                header: "Result",
                cell: (r) => {
                  const s = r.summary as Summary;
                  if (r.error) return <span className="text-xs text-destructive">{r.error}</span>;
                  if (s.skippedReason)
                    return <span className="text-xs text-muted-foreground">{s.skippedReason}</span>;
                  return (
                    <span className="text-xs text-muted-foreground">
                      {s.findings ?? 0} found · {s.tasksCreated ?? 0} tasks · {s.deduped ?? 0}{" "}
                      already tracked
                    </span>
                  );
                },
              },
              { key: "attempt", header: "Attempt", hideOnMobile: true, cell: (r) => r.attempt },
              {
                key: "when",
                header: "Queued",
                hideOnMobile: true,
                cell: (r) => formatDate(r.createdAt),
              },
            ]}
          />
          <Pagination
            page={result.page}
            pageCount={result.pageCount}
            total={result.total}
            searchParams={flat(raw)}
            basePath="/automation/runs"
          />
        </>
      )}
    </>
  );
}
