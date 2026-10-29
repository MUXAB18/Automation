import { FolderKanban } from "lucide-react";
import { listProjects } from "@automation/db";
import { DataTable, dash } from "@/components/data-table";
import { ClearFilters, FilterBar, FilterSelect, SearchInput } from "@/components/filters";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { ScopeBadge } from "@/components/scope-badge";
import { DevelopmentNotice, EmptyState, SampleBadge, SampleBanner } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { getScope } from "@/lib/scope";
import { requireSection } from "@/lib/sections";
import { page, flat, oneOf, str, type RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Projects" };

const STATUSES = ["active", "paused", "completed", "archived"] as const;
const KINDS = ["seo", "social", "content", "general"] as const;

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const actor = await requireActor();
  await requireSection(actor, "projects");
  const raw = await searchParams;
  const scope = await getScope(actor);
  const filters = {
    q: str(raw.q),
    status: oneOf(raw.status, STATUSES),
    kind: oneOf(raw.kind, KINDS),
  };
  const result = await listProjects(actor, {
    ...filters,
    clientId: scope.clientId,
    page: page(raw.page),
  });
  const filtered = Boolean(filters.q || filters.status || filters.kind);

  return (
    <>
      <PageHeader
        title="Projects"
        description="Programmes of work for each client."
        breadcrumbs={[{ label: "Projects" }]}
        badges={<ScopeBadge scope={scope} />}
      />
      <DevelopmentNotice>
        Creating and editing projects is coming next. This list shows the projects stored in your
        database.
      </DevelopmentNotice>
      <SampleBanner show={result.rows.some((p) => p.isSample)} />

      <FilterBar>
        <SearchInput placeholder="Search projects" />
        <FilterSelect
          name="status"
          label="Filter by status"
          allLabel="All statuses"
          options={STATUSES.map((s) => ({ value: s, label: s }))}
        />
        <FilterSelect
          name="kind"
          label="Filter by type"
          allLabel="All types"
          options={KINDS.map((s) => ({ value: s, label: s }))}
        />
        <ClearFilters names={["q", "status", "kind"]} />
      </FilterBar>

      {result.total === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={filtered ? "No projects match your filters" : "No projects yet"}
          description={
            filtered
              ? "Try a different search or clear the filters."
              : "Projects you can access will be listed here."
          }
        />
      ) : (
        <>
          <DataTable
            caption="Projects"
            rows={result.rows}
            columns={[
              {
                key: "name",
                header: "Project",
                cell: (p) => (
                  <span className="inline-flex items-center gap-2">
                    {p.name} <SampleBadge show={p.isSample} />
                  </span>
                ),
              },
              { key: "client", header: "Client", cell: (p) => p.client.name },
              {
                key: "kind",
                header: "Type",
                hideOnMobile: true,
                cell: (p) => <span className="capitalize">{p.kind}</span>,
              },
              {
                key: "status",
                header: "Status",
                cell: (p) => <StatusBadge kind="project" status={p.status} />,
              },
              {
                key: "members",
                header: "Members",
                align: "right",
                hideOnMobile: true,
                cell: (p) => dash(p._count.projectMemberships || null),
              },
            ]}
          />
          <Pagination
            page={result.page}
            pageCount={result.pageCount}
            total={result.total}
            searchParams={flat(raw)}
            basePath="/projects"
          />
        </>
      )}
    </>
  );
}
