import Link from "next/link";
import { MessageSquare, Paperclip } from "lucide-react";
import { BOARD_COLUMNS, STATUS_LABELS, getBoard } from "@automation/db";
import { FilterBar, FilterSelect, SearchInput, ClearFilters } from "@/components/filters";
import { SampleBadge, SampleBanner } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { MoveMenu } from "@/components/tasks/move-menu";
import { formatDay } from "@/lib/format";
import { getScope } from "@/lib/scope";
import { oneOf, str, type RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Task board" };

export default async function BoardPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const actor = await requireActor();
  const raw = await searchParams;
  const scope = await getScope(actor);
  const board = await getBoard(actor, {
    q: str(raw.q),
    priority: oneOf(raw.priority, ["low", "medium", "high", "urgent"] as const),
    assignee: oneOf(raw.assignee, ["me", "none"] as const),
    clientId: scope.clientId,
    projectId: scope.projectId,
  });
  const cards = board.columns.flatMap((c) => c.cards);

  return (
    <>
      <SampleBanner show={cards.some((c) => c.isSample)} />
      <FilterBar>
        <SearchInput placeholder="Search the board" />
        <FilterSelect
          name="priority"
          label="Filter by priority"
          allLabel="Any priority"
          options={["low", "medium", "high", "urgent"].map((p) => ({ value: p, label: p }))}
        />
        <FilterSelect
          name="assignee"
          label="Filter by assignee"
          allLabel="Anyone"
          options={[
            { value: "me", label: "Assigned to me" },
            { value: "none", label: "Unassigned" },
          ]}
        />
        <ClearFilters names={["q", "priority", "assignee"]} />
      </FilterBar>
      <p className="mb-3 text-xs text-muted-foreground">
        Use the arrows on a card to move it. Only the moves you are allowed to make are offered;
        moves that need a reason or evidence open the task.
      </p>
      <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
        <div className="flex min-w-max gap-4">
          {board.columns.map((column) => (
            <section
              key={column.status}
              aria-label={STATUS_LABELS[column.status]}
              className="w-72 shrink-0 rounded-xl bg-muted/50 p-3"
            >
              <header className="mb-3 flex items-center justify-between px-1">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <StatusBadge kind="task" status={column.status} />
                </h2>
                <span className="text-xs tabular-nums text-muted-foreground">{column.total}</span>
              </header>
              {column.cards.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                  {column.status === "completed"
                    ? "Nothing completed in the last 14 days"
                    : "No tasks"}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {column.cards.map((t) => (
                    <li
                      key={t.id}
                      className="rounded-lg border border-border bg-card p-3 shadow-card"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={`/tasks/${t.id}`}
                          className="text-sm font-medium leading-snug hover:underline"
                        >
                          {t.title}
                        </Link>
                        <MoveMenu taskId={t.id} title={t.title} moves={t.moves} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t.client.name}
                        {t.project ? ` · ${t.project.name}` : ""}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <StatusBadge kind="priority" status={t.priority} />
                        <SampleBadge show={t.isSample} />
                        {t.overdue ? <Badge tone="destructive">overdue</Badge> : null}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                        <span className="truncate">{t.assignee?.name ?? "Unassigned"}</span>
                        <span className="flex shrink-0 items-center gap-2">
                          {t.dueAt ? <span>{formatDay(t.dueAt, t.client.timezone)}</span> : null}
                          {t._count.comments > 0 ? (
                            <span className="inline-flex items-center gap-0.5">
                              <MessageSquare className="size-3" aria-hidden />
                              {t._count.comments}
                            </span>
                          ) : null}
                          {t._count.attachments > 0 ? (
                            <span className="inline-flex items-center gap-0.5">
                              <Paperclip className="size-3" aria-hidden />
                              {t._count.attachments}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    </li>
                  ))}
                  {column.total > column.cards.length ? (
                    <li className="px-1 text-center text-xs text-muted-foreground">
                      +{column.total - column.cards.length} more.{" "}
                      <Link
                        className="text-primary hover:underline"
                        href={`/tasks?status=${column.status}`}
                      >
                        Open the list
                      </Link>
                    </li>
                  ) : null}
                </ul>
              )}
            </section>
          ))}
        </div>
      </div>
      <p className="sr-only">Columns: {BOARD_COLUMNS.map((s) => STATUS_LABELS[s]).join(", ")}</p>
    </>
  );
}
