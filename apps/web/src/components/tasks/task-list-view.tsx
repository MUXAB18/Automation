import { ListChecks, MessageSquare, Paperclip } from "lucide-react";
import { searchTasks, type TaskFilters, type TaskSort } from "@automation/db";
import { DataTable, dash } from "@/components/data-table";
import { ClearFilters, FilterBar, FilterSelect, SearchInput } from "@/components/filters";
import { Pagination } from "@/components/pagination";
import { EmptyState, SampleBadge, SampleBanner } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { formatDay, formatEffort } from "@/lib/format";
import { flat, oneOf, page, str, type RawParams } from "@/lib/search-params";
import type { Scope } from "@/lib/scope";
import type { SessionActor } from "@/lib/session";

const STATUSES = [
  "backlog",
  "assigned",
  "in_progress",
  "ready_for_review",
  "changes_requested",
  "blocked",
  "approved",
  "completed",
  "cancelled",
] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const TYPES = ["general", "seo_fix", "content", "social", "reporting"] as const;
const label = (v: string) => v.replace(/_/g, " ");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** "me", "none", or one person (a user id from the workload page). Anything else is ignored. */
const assigneeParam = (v: RawParams[string]) => {
  const value = str(v);
  return value === "me" || value === "none" || (value && UUID.test(value)) ? value : undefined;
};

/**
 * The task table with its filters, shared by All Tasks, My Tasks and Overdue. `preset` fixes part of the
 * query (e.g. only my tasks); the visitor's filters narrow it further.
 */
export async function TaskListView({
  actor,
  scope,
  raw,
  basePath,
  preset,
  hideAssignee,
  emptyTitle,
  emptyHint,
}: {
  actor: SessionActor;
  scope: Scope;
  raw: RawParams;
  basePath: string;
  preset: Pick<TaskFilters, "assignee" | "overdue" | "open">;
  hideAssignee?: boolean;
  emptyTitle: string;
  emptyHint: string;
}) {
  const status = oneOf(raw.status, STATUSES);
  const filters: TaskFilters & { sort?: TaskSort } = {
    ...preset,
    q: str(raw.q),
    status,
    priority: oneOf(raw.priority, PRIORITIES),
    type: oneOf(raw.type, TYPES),
    assignee: preset.assignee ?? assigneeParam(raw.assignee),
    // "Open" presets give way to an explicit status choice.
    open: status ? false : preset.open,
    clientId: scope.clientId,
    projectId: scope.projectId,
    page: page(raw.page),
    sort: oneOf(raw.sort, ["due", "recent", "priority"] as const),
  };
  const result = await searchTasks(actor, filters);
  const filtered = Boolean(
    filters.q ||
    filters.status ||
    filters.priority ||
    filters.type ||
    (!preset.assignee && filters.assignee),
  );

  return (
    <>
      <SampleBanner show={result.rows.some((t) => t.isSample)} />
      <FilterBar>
        <SearchInput placeholder="Search tasks" />
        <FilterSelect
          name="status"
          label="Filter by status"
          allLabel="Any status"
          options={STATUSES.map((s) => ({ value: s, label: label(s) }))}
        />
        <FilterSelect
          name="priority"
          label="Filter by priority"
          allLabel="Any priority"
          options={PRIORITIES.map((s) => ({ value: s, label: s }))}
        />
        <FilterSelect
          name="type"
          label="Filter by type"
          allLabel="Any type"
          options={TYPES.map((s) => ({ value: s, label: label(s) }))}
        />
        {preset.assignee ? null : (
          <FilterSelect
            name="assignee"
            label="Filter by assignee"
            allLabel="Anyone"
            options={[
              { value: "me", label: "Assigned to me" },
              { value: "none", label: "Unassigned" },
            ]}
          />
        )}
        <FilterSelect
          name="sort"
          label="Sort"
          allLabel="Sort: due date"
          options={[
            { value: "priority", label: "Priority" },
            { value: "recent", label: "Recently updated" },
          ]}
        />
        <ClearFilters names={["q", "status", "priority", "type", "assignee", "sort"]} />
      </FilterBar>

      {result.total === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={filtered ? "No tasks match your filters" : emptyTitle}
          description={filtered ? "Try a different search or clear the filters." : emptyHint}
        />
      ) : (
        <>
          <DataTable
            caption="Tasks"
            rows={result.rows}
            rowHref={(t) => `/tasks/${t.id}`}
            columns={[
              {
                key: "title",
                header: "Task",
                cell: (t) => (
                  <span className="block">
                    <span className="inline-flex flex-wrap items-center gap-2">
                      {t.title} <SampleBadge show={t.isSample} />
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs font-normal text-muted-foreground">
                      <span>
                        {t.client.name}
                        {t.project ? ` · ${t.project.name}` : ""}
                      </span>
                      <span className="capitalize">{label(t.type)}</span>
                      {t._count.comments > 0 ? (
                        <span className="inline-flex items-center gap-1" title="Comments">
                          <MessageSquare className="size-3" aria-hidden />
                          {t._count.comments}
                          <span className="sr-only"> comments</span>
                        </span>
                      ) : null}
                      {t._count.attachments > 0 ? (
                        <span className="inline-flex items-center gap-1" title="Attachments">
                          <Paperclip className="size-3" aria-hidden />
                          {t._count.attachments}
                          <span className="sr-only"> attachments</span>
                        </span>
                      ) : null}
                    </span>
                  </span>
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
              ...(hideAssignee
                ? []
                : [
                    {
                      key: "assignee",
                      header: "Assignee",
                      hideOnMobile: true,
                      cell: (t: (typeof result.rows)[number]) => dash(t.assignee?.name),
                    },
                  ]),
              {
                key: "effort",
                header: "Estimate",
                hideOnMobile: true,
                cell: (t) => formatEffort(t.estimateMinutes),
              },
              {
                key: "due",
                header: "Due",
                cell: (t) =>
                  t.dueAt ? (
                    <span className="inline-flex flex-wrap items-center gap-2">
                      {formatDay(t.dueAt, t.client.timezone)}
                      {t.overdue ? <Badge tone="destructive">overdue</Badge> : null}
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
            basePath={basePath}
          />
        </>
      )}
    </>
  );
}
