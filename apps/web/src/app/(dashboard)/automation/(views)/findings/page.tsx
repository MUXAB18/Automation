import Link from "next/link";
import { SearchCheck } from "lucide-react";
import { KIND_LABEL, RULE_KINDS, listFindings, type RuleKind } from "@automation/db";
import { DataTable, formatDate } from "@/components/data-table";
import { ClearFilters, FilterBar, FilterSelect } from "@/components/filters";
import { Pagination } from "@/components/pagination";
import { EmptyState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { getScope } from "@/lib/scope";
import { flat, oneOf, page, type RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Automation findings" };

const STATUSES = ["open", "resolved", "all"] as const;

export default async function FindingsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const actor = await requireActor();
  const raw = await searchParams;
  const scope = await getScope(actor);
  const status = oneOf(raw.status, STATUSES);
  const kind = oneOf(raw.kind, RULE_KINDS);
  const result = await listFindings(actor, {
    clientId: scope.clientId,
    status,
    kind,
    page: page(raw.page),
  });

  return (
    <>
      <FilterBar>
        <FilterSelect
          name="status"
          label="Filter by status"
          allLabel="Open"
          options={STATUSES.filter((s) => s !== "open").map((s) => ({ value: s, label: s }))}
        />
        <FilterSelect
          name="kind"
          label="Filter by rule type"
          allLabel="All rule types"
          options={RULE_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
        />
        <ClearFilters names={["status", "kind"]} />
      </FilterBar>
      {result.total === 0 ? (
        <EmptyState
          icon={SearchCheck}
          title="No findings"
          description="Problems the rules detect appear here, one entry per problem, however often it is seen."
        />
      ) : (
        <>
          <DataTable
            caption="Automation findings"
            rows={result.rows}
            columns={[
              {
                key: "title",
                header: "Finding",
                cell: (f) => <span className="font-medium">{f.title}</span>,
              },
              {
                key: "kind",
                header: "Rule type",
                hideOnMobile: true,
                cell: (f) => KIND_LABEL[f.kind as RuleKind],
              },
              { key: "client", header: "Client", hideOnMobile: true, cell: (f) => f.client.name },
              {
                key: "severity",
                header: "Severity",
                cell: (f) => <StatusBadge kind="severity" status={f.severity} />,
              },
              {
                key: "status",
                header: "Status",
                cell: (f) => (
                  <StatusBadge kind="issue" status={f.status === "open" ? "open" : "fixed"} />
                ),
              },
              {
                key: "task",
                header: "Task",
                cell: (f) =>
                  f.task ? (
                    <Link href={`/tasks/${f.task.id}`} className="text-primary underline">
                      {f.task.title.slice(0, 50)}
                    </Link>
                  ) : (
                    "None"
                  ),
              },
              {
                key: "seen",
                header: "Seen",
                hideOnMobile: true,
                cell: (f) => `${f.occurrences}× · last ${formatDate(f.lastSeenAt)}`,
              },
            ]}
          />
          <Pagination
            page={result.page}
            pageCount={result.pageCount}
            total={result.total}
            searchParams={flat(raw)}
            basePath="/automation/findings"
          />
        </>
      )}
    </>
  );
}
