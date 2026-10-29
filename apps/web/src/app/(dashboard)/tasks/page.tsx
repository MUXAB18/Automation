import { ListChecks } from "lucide-react";
import { listTasks } from "@automation/db";
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
import { DevelopmentNotice, EmptyState, SampleBadge, SampleBanner } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { getScope } from "@/lib/scope";
import { requireSection } from "@/lib/sections";
import { flag, flat, oneOf, page, str, type RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Tasks" };

const STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
  "cancelled",
] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const actor = await requireActor();
  await requireSection(actor, "tasks");
  const raw = await searchParams;
  const scope = await getScope(actor);
  const filters = {
    q: str(raw.q),
    status: oneOf(raw.status, STATUSES),
    priority: oneOf(raw.priority, PRIORITIES),
    mine: flag(raw.mine),
    open: flag(raw.open),
  };
  const result = await listTasks(actor, {
    ...filters,
    clientId: scope.clientId,
    projectId: scope.projectId,
    page: page(raw.page),
  });
  const filtered = Boolean(
    filters.q || filters.status || filters.priority || filters.mine || filters.open,
  );
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Everything that needs doing, across clients."
        breadcrumbs={[{ label: "Tasks" }]}
        badges={<ScopeBadge scope={scope} />}
      />
      <DevelopmentNotice>
        Creating, assigning and updating tasks is coming next. This list shows the tasks stored in
        your database.
      </DevelopmentNotice>
      <SampleBanner show={result.rows.some((t) => t.isSample)} />

      <FilterBar>
        <SearchInput placeholder="Search tasks" />
        <FilterSelect
          name="status"
          label="Filter by status"
          allLabel="All statuses"
          options={STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))}
        />
        <FilterSelect
          name="priority"
          label="Filter by priority"
          allLabel="All priorities"
          options={PRIORITIES.map((s) => ({ value: s, label: s }))}
        />
        <FilterToggle name="mine" label="Assigned to me" />
        <FilterToggle name="open" label="Open only" />
        <ClearFilters names={["q", "status", "priority", "mine", "open"]} />
      </FilterBar>

      {result.total === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={filtered ? "No tasks match your filters" : "No tasks yet"}
          description={
            filtered
              ? "Try a different search or clear the filters."
              : "Tasks for the clients you work on will be listed here."
          }
        />
      ) : (
        <>
          <DataTable
            caption="Tasks"
            rows={result.rows}
            columns={[
              {
                key: "title",
                header: "Task",
                cell: (t) => (
                  <div>
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {t.title} <SampleBadge show={t.isSample} />
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t.client.name}
                      {t.project ? ` · ${t.project.name}` : ""}
                    </p>
                  </div>
                ),
              },
              {
                key: "status",
                header: "Status",
                cell: (t) => <StatusBadge kind="task" status={t.status} />,
              },
              {
                key: "priority",
                header: "Priority",
                hideOnMobile: true,
                cell: (t) => <StatusBadge kind="priority" status={t.priority} />,
              },
              {
                key: "assignee",
                header: "Assignee",
                hideOnMobile: true,
                cell: (t) => dash(t.assignee?.name),
              },
              {
                key: "due",
                header: "Due",
                cell: (t) =>
                  t.dueAt ? (
                    <span className="inline-flex items-center gap-2">
                      {formatDate(t.dueAt)}
                      {t.dueAt < now && t.status !== "done" && t.status !== "cancelled" ? (
                        <Badge tone="destructive">overdue</Badge>
                      ) : null}
                    </span>
                  ) : (
                    dash(null)
                  ),
              },
            ]}
          />
          <Pagination
            page={result.page}
            pageCount={result.pageCount}
            total={result.total}
            searchParams={flat(raw)}
            basePath="/tasks"
          />
        </>
      )}
    </>
  );
}
