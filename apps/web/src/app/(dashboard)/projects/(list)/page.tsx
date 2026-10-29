import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { listClientsForProjects, searchProjects } from "@automation/db";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, dash, formatDate } from "@/components/data-table";
import {
  ClearFilters,
  FilterBar,
  FilterSelect,
  FilterToggle,
  SearchInput,
} from "@/components/filters";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { ScopeBadge } from "@/components/scope-badge";
import { EmptyState, SampleBadge, SampleBanner } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { getScope } from "@/lib/scope";
import { requireSection } from "@/lib/sections";
import { flag, flat, oneOf, page, str, type RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";
import { projectStatusConfirmAction } from "../actions";

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
    archived: flag(raw.archived),
  };
  const [result, creatable] = await Promise.all([
    searchProjects(actor, { ...filters, clientId: scope.clientId, page: page(raw.page) }),
    listClientsForProjects(actor),
  ]);
  const filtered = Boolean(filters.q || filters.status || filters.kind || filters.archived);
  const newHref = `/projects/new${scope.clientId && creatable.some((c) => c.id === scope.clientId) ? `?client=${scope.clientId}` : ""}`;

  return (
    <>
      <PageHeader
        title="Projects"
        description="Programmes of work for each client."
        breadcrumbs={[{ label: "Projects" }]}
        badges={<ScopeBadge scope={scope} />}
        actions={
          creatable.length > 0 ? (
            <Button asChild>
              <Link href={newHref}>New project</Link>
            </Button>
          ) : null
        }
      />
      <SampleBanner show={result.rows.some((p) => p.isSample)} />

      <FilterBar>
        <SearchInput placeholder="Search name, goals or client" label="Search projects" />
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
        <FilterToggle name="archived" label="Archived" />
        <ClearFilters names={["q", "status", "kind", "archived"]} />
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
          action={
            !filtered && creatable.length > 0
              ? { label: "Create a project", href: newHref }
              : undefined
          }
        />
      ) : (
        <>
          <DataTable
            caption="Projects"
            rows={result.rows}
            rowHref={(p) => `/projects/${p.id}`}
            columns={[
              {
                key: "name",
                header: "Project",
                cell: (p) => (
                  <span className="inline-flex flex-wrap items-center gap-2">
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
                key: "dates",
                header: "Dates",
                hideOnMobile: true,
                cell: (p) =>
                  dash(
                    p.startsOn || p.endsOn
                      ? `${formatDate(p.startsOn) ?? "…"} – ${formatDate(p.endsOn) ?? "ongoing"}`
                      : null,
                  ),
              },
              {
                key: "open",
                header: "Open tasks",
                align: "right",
                hideOnMobile: true,
                cell: (p) => p._count.tasks,
              },
              {
                key: "people",
                header: "People",
                align: "right",
                hideOnMobile: true,
                cell: (p) => p._count.projectMemberships,
              },
              {
                key: "actions",
                header: "",
                align: "right",
                cell: (p) =>
                  p.canManage ? (
                    <ConfirmDialog
                      triggerLabel={p.status === "archived" ? "Restore" : "Archive"}
                      triggerVariant="ghost"
                      title={p.status === "archived" ? `Restore ${p.name}?` : `Archive ${p.name}?`}
                      description={
                        p.status === "archived"
                          ? "The project becomes active again."
                          : "Archived projects leave the default list and selectors. Tasks, content and history are kept, and you can restore it any time."
                      }
                      confirmLabel={p.status === "archived" ? "Restore project" : "Archive project"}
                      destructive={p.status !== "archived"}
                      action={projectStatusConfirmAction}
                      fields={{
                        projectId: p.id,
                        status: p.status === "archived" ? "active" : "archived",
                      }}
                    />
                  ) : null,
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
