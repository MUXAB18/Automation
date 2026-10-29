import { FileBarChart } from "lucide-react";
import { listReports } from "@automation/db";
import { DataTable, formatDate } from "@/components/data-table";
import { ClearFilters, FilterBar, FilterSelect } from "@/components/filters";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { ScopeBadge } from "@/components/scope-badge";
import { DevelopmentNotice, EmptyState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { getScope } from "@/lib/scope";
import { requireSection } from "@/lib/sections";
import { flat, oneOf, page, type RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Reports" };

const STATUSES = ["draft", "generating", "ready", "approved", "delivered", "failed"] as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const actor = await requireActor();
  await requireSection(actor, "reports");
  const raw = await searchParams;
  const scope = await getScope(actor);
  const status = oneOf(raw.status, STATUSES);
  const result = await listReports(actor, {
    clientId: scope.clientId,
    status,
    page: page(raw.page),
  });

  return (
    <>
      <PageHeader
        title="Reports"
        description="Client reports and their delivery."
        breadcrumbs={[{ label: "Reports" }]}
        badges={<ScopeBadge scope={scope} />}
      />
      <DevelopmentNotice>
        Generating and emailing reports is coming next. This list shows reports stored in your
        database.
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
          icon={FileBarChart}
          title={status ? "No reports with this status" : "No reports yet"}
          description="Reports built from your agency's templates will be listed here."
        />
      ) : (
        <>
          <DataTable
            caption="Reports"
            rows={result.rows}
            columns={[
              {
                key: "title",
                header: "Report",
                cell: (r) => <span className="font-medium">{r.title}</span>,
              },
              { key: "client", header: "Client", cell: (r) => r.client.name },
              {
                key: "period",
                header: "Period",
                hideOnMobile: true,
                cell: (r) => `${formatDate(r.periodStart)} – ${formatDate(r.periodEnd)}`,
              },
              {
                key: "template",
                header: "Template",
                hideOnMobile: true,
                cell: (r) => r.template?.name ?? "—",
              },
              {
                key: "status",
                header: "Status",
                cell: (r) => <StatusBadge kind="report" status={r.status} />,
              },
            ]}
          />
          <Pagination
            page={result.page}
            pageCount={result.pageCount}
            total={result.total}
            searchParams={flat(raw)}
            basePath="/reports"
          />
        </>
      )}
    </>
  );
}
