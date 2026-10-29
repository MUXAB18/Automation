import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ForbiddenError,
  NotFoundError,
  getTaskFormOptions,
  listClientsForTasks,
} from "@automation/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getScope } from "@/lib/scope";
import { requireSection } from "@/lib/sections";
import { str, type RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";
import { createTaskAction } from "../actions";
import { TaskForm } from "../task-form";

export const metadata = { title: "New task" };

export default async function NewTaskPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const actor = await requireActor();
  await requireSection(actor, "tasks");
  const raw = await searchParams;
  const crumbs = [{ label: "Tasks", href: "/tasks" }, { label: "New task" }];
  const clients = await listClientsForTasks(actor);
  if (clients.length === 0) notFound();

  const scope = await getScope(actor);
  const clientId =
    str(raw.client) ??
    (scope.clientId && clients.some((c) => c.id === scope.clientId)
      ? scope.clientId
      : clients.length === 1
        ? clients[0]!.id
        : undefined);

  if (!clientId) {
    return (
      <>
        <PageHeader
          title="New task"
          description="Which client is this task for?"
          breadcrumbs={crumbs}
        />
        <Card>
          <CardContent className="pt-6">
            <ul className="divide-y divide-border">
              {clients.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/tasks/new?client=${c.id}`}
                    className="flex items-center justify-between py-3 text-sm font-medium hover:underline"
                  >
                    {c.name}
                    <span aria-hidden className="text-muted-foreground">
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </>
    );
  }

  let options;
  try {
    options = await getTaskFormOptions(actor, clientId);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) notFound();
    throw error;
  }
  if (!options.client || !options.canCreate) notFound();
  const projectId = str(raw.project);
  return (
    <>
      <PageHeader
        title="New task"
        description={`A piece of work for ${options.client.name}.`}
        breadcrumbs={crumbs}
      />
      <TaskForm
        mode="create"
        action={createTaskAction}
        clientId={clientId}
        clientName={options.client.name}
        projects={options.projects}
        content={options.content}
        issues={options.issues}
        people={options.people}
        canAssign={options.canAssign}
        userId={actor.userId}
        values={{
          projectId: options.projects.some((p) => p.id === projectId)
            ? projectId
            : scope.projectId && options.projects.some((p) => p.id === scope.projectId)
              ? scope.projectId
              : null,
        }}
      />
    </>
  );
}
