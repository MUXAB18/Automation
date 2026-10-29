import { TaskListView } from "@/components/tasks/task-list-view";
import { getScope } from "@/lib/scope";
import type { RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Overdue tasks" };

/** Past their due day (in the client's time zone) and neither completed nor cancelled. */
export default async function OverdueTasksPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const actor = await requireActor();
  const raw = await searchParams;
  const scope = await getScope(actor);
  return (
    <TaskListView
      actor={actor}
      scope={scope}
      raw={raw}
      basePath="/tasks/overdue"
      preset={{ overdue: true }}
      emptyTitle="Nothing is overdue"
      emptyHint="Unfinished tasks past their due day will appear here, oldest first."
    />
  );
}
