import { CalendarDays } from "lucide-react";
import { listContent } from "@automation/db";
import { DataTable, dash, formatDate } from "@/components/data-table";
import { ClearFilters, FilterBar, FilterSelect, SearchInput } from "@/components/filters";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { ScopeBadge } from "@/components/scope-badge";
import { DevelopmentNotice, EmptyState, SampleBadge, SampleBanner } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { getScope } from "@/lib/scope";
import { requireSection } from "@/lib/sections";
import { flat, oneOf, page, str, type RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Content Calendar" };

const STATUSES = [
  "draft",
  "in_review",
  "changes_requested",
  "approved",
  "scheduled",
  "publishing",
  "published",
  "failed",
] as const;

export default async function ContentPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const actor = await requireActor();
  await requireSection(actor, "content");
  const raw = await searchParams;
  const scope = await getScope(actor);
  const filters = { q: str(raw.q), status: oneOf(raw.status, STATUSES) };
  const result = await listContent(actor, {
    ...filters,
    clientId: scope.clientId,
    projectId: scope.projectId,
    page: page(raw.page),
  });
  const filtered = Boolean(filters.q || filters.status);

  return (
    <>
      <PageHeader
        title="Content Calendar"
        description="Plan, review and schedule content."
        breadcrumbs={[{ label: "Content Calendar" }]}
        badges={<ScopeBadge scope={scope} />}
      />
      <DevelopmentNotice>
        Drafting, reviewing and scheduling content is coming next. This list shows content stored in
        your database, soonest first.
      </DevelopmentNotice>
      <SampleBanner show={result.rows.some((c) => c.isSample)} />

      <FilterBar>
        <SearchInput placeholder="Search content" />
        <FilterSelect
          name="status"
          label="Filter by status"
          allLabel="All statuses"
          options={STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))}
        />
        <ClearFilters names={["q", "status"]} />
      </FilterBar>

      {result.total === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={filtered ? "No content matches your filters" : "Nothing planned yet"}
          description={
            filtered
              ? "Try a different search or clear the filters."
              : "Content with a scheduled date will appear here in date order."
          }
        />
      ) : (
        <>
          <DataTable
            caption="Content items"
            rows={result.rows}
            columns={[
              {
                key: "title",
                header: "Content",
                cell: (c) => (
                  <div>
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {c.title} <SampleBadge show={c.isSample} />
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {c.client.name}
                      {c.project ? ` · ${c.project.name}` : ""}
                    </p>
                  </div>
                ),
              },
              {
                key: "channel",
                header: "Channel",
                hideOnMobile: true,
                cell: (c) => <span className="capitalize">{c.channel.replace(/_/g, " ")}</span>,
              },
              {
                key: "status",
                header: "Status",
                cell: (c) => <StatusBadge kind="content" status={c.status} />,
              },
              { key: "when", header: "Scheduled", cell: (c) => dash(formatDate(c.scheduledFor)) },
            ]}
          />
          <Pagination
            page={result.page}
            pageCount={result.pageCount}
            total={result.total}
            searchParams={flat(raw)}
            basePath="/content"
          />
        </>
      )}
    </>
  );
}
