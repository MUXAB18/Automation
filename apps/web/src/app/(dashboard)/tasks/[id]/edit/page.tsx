import { notFound } from "next/navigation";
import { NotFoundError, getTaskDetail, getTaskFormOptions } from "@automation/db";
import { PageHeader } from "@/components/page-header";
import { dateInTimeZone } from "@automation/db";
import { requireSection } from "@/lib/sections";
import { requireActor } from "@/lib/session";
import { updateTaskAction } from "../../actions";
import { TaskForm } from "../../task-form";

export const metadata = { title: "Edit task" };

export default async function EditTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  await requireSection(actor, "tasks");
  const { id } = await params;
  let detail;
  try {
    detail = await getTaskDetail(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  // Only people who may edit this task (and only while it is unfinished) see the form.
  if (!detail.permissions.canEdit) notFound();
  const { task } = detail;
  const options = await getTaskFormOptions(actor, task.clientId);
  return (
    <>
      <PageHeader
        title={`Edit ${task.title}`}
        breadcrumbs={[
          { label: "Tasks", href: "/tasks" },
          { label: task.title, href: `/tasks/${id}` },
          { label: "Edit" },
        ]}
      />
      <TaskForm
        mode="edit"
        action={updateTaskAction.bind(null, id)}
        clientName={task.client.name}
        projects={options.projects}
        content={options.content}
        issues={options.issues}
        people={options.people}
        canAssign={options.canAssign}
        userId={actor.userId}
        values={{
          title: task.title,
          description: task.description,
          acceptanceCriteria: task.acceptanceCriteria,
          type: task.type,
          priority: task.priority,
          projectId: task.projectId,
          dueDate: task.dueAt ? dateInTimeZone(task.dueAt, task.client.timezone) : undefined,
          estimateHours: task.estimateMinutes ? String(task.estimateMinutes / 60) : undefined,
          contentItemId: task.contentItemId,
          seoIssueIds: task.seoIssues.map((i) => i.id),
          labels: task.labels,
        }}
      />
    </>
  );
}
