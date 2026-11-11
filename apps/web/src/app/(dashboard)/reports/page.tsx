import Link from "next/link";
import { FileBarChart } from "lucide-react";
import { listReportsFor } from "@automation/db";
import { DataTable, formatDate } from "@/components/data-table";
import { ClearFilters, FilterBar, FilterSelect } from "@/components/filters";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { ScopeBadge } from "@/components/scope-badge";
import { EmptyState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { getScope } from "@/lib/scope";
import { requireSection } from "@/lib/sections";
import { flat, oneOf, page, type RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";
import { generateReportAction } from "./actions";
import { GenerateButton } from "./panels";

export const metadata = { title: "Reports" };

const STATUSES = ["draft", "generating", "ready", "approved", "delivered", "failed"] as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const actor = await requireActor();
  await requireSection(actor, "reports");
  const raw = await searchParams;
  const scope = await getScope(actor);
  const status = oneOf(raw.status, STATUSES);
  const result = await listReportsFor(actor, {
    clientId: scope.clientId,
    status,
    page: page(raw.page),
  });
  return (
    <>
      <PageHeader
        title="Reports"
        description="Reports are built from synced data, reviewed by a person, then delivered as PDF by email."
        breadcrumbs={[{ label: "Reports" }]}
        badges={<ScopeBadge scope={scope} />}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/reports/schedule">Schedule and template</Link>
            </Button>
            {scope.clientId ? (
              <GenerateButton clientId={scope.clientId} action={generateReportAction} />
            ) : null}
          </div>
        }
      />
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
          description={
            scope.clientId
              ? "Generate one for the last 15 days, or set up a schedule."
              : "Choose a client in the header to generate a report."
          }
        />
      ) : (
        <>
          <DataTable
            caption="Reports"
            rows={result.rows}
            rowHref={(r) => `/reports/${r.id}`}
            columns={[
              {
                key: "title",
                header: "Report",
                cell: (r) => <span className="font-medium">{r.title}</span>,
              },
              { key: "client", header: "Client", hideOnMobile: true, cell: (r) => r.client.name },
              {
                key: "period",
                header: "Period",
                hideOnMobile: true,
                cell: (r) =>
                  `${r.periodStart.toISOString().slice(0, 10)} to ${r.periodEnd.toISOString().slice(0, 10)}${r.revision > 1 ? ` (rev ${r.revision})` : ""}`,
              },
              {
                key: "status",
                header: "Status",
                cell: (r) => <StatusBadge kind="report" status={r.status} />,
              },
              {
                key: "source",
                header: "Created",
                hideOnMobile: true,
                cell: (r) => <span className="capitalize">{r.source}</span>,
              },
              {
                key: "when",
                header: "Generated",
                hideOnMobile: true,
                cell: (r) => formatDate(r.generatedAt) ?? "Not yet",
              },
              {
                key: "deliveries",
                header: "Emails",
                hideOnMobile: true,
                cell: (r) => r._count.reportDeliveries,
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
