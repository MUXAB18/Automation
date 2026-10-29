import { TaskListView } from "@/components/tasks/task-list-view";
import { getScope } from "@/lib/scope";
import type { RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";

export const metadata = { title: "All tasks" };

export default async function AllTasksPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const actor = await requireActor();
  const raw = await searchParams;
  const scope = await getScope(actor);
  return (
    <TaskListView
      actor={actor}
      scope={scope}
      raw={raw}
      basePath="/tasks"
      preset={{}}
      emptyTitle="No tasks yet"
      emptyHint="Tasks for the clients you work on will be listed here. Create one with “New task”."
    />
  );
}
