import { TaskListView } from "@/components/tasks/task-list-view";
import { getScope } from "@/lib/scope";
import type { RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";

export const metadata = { title: "My tasks" };

export default async function MyTasksPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const actor = await requireActor();
  const raw = await searchParams;
  const scope = await getScope(actor);
  return (
    <TaskListView
      actor={actor}
      scope={scope}
      raw={raw}
      basePath="/tasks/mine"
      preset={{ assignee: "me", open: true }}
      hideAssignee
      emptyTitle="Nothing is assigned to you"
      emptyHint="Tasks assigned to you that are not finished will appear here."
    />
  );
}
