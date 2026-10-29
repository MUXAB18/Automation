import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, ExternalLink, Link2, Paperclip } from "lucide-react";
import { NotFoundError, STATUS_LABELS, getTaskDetail, type TaskStatusName } from "@automation/db";
import { SampleBadge } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { TransitionButton } from "@/components/tasks/transition-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { formatDateTime, formatDay, formatEffort } from "@/lib/format";
import { requireSection } from "@/lib/sections";
import { describeEvent } from "@/lib/task-events";
import { requireActor } from "@/lib/session";
import {
  addCommentAction,
  addDependencyAction,
  logTimeAction,
  uploadAttachmentAction,
} from "../actions";
import {
  AssignForm,
  CommentForm,
  DeleteCommentButton,
  DeleteTimeButton,
  DependencyForm,
  LogTimeForm,
  RemoveAttachmentButton,
  RemoveDependencyButton,
  UploadForm,
} from "./task-panels";

export const metadata = { title: "Task" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  await requireSection(actor, "tasks");
  const { id } = await params;
  let d;
  try {
    d = await getTaskDetail(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { task, permissions: can } = d;
  const tz = task.client.timezone;
  const estimate = task.estimateMinutes ?? 0;
  const progress =
    estimate > 0 ? Math.min(100, Math.round((d.loggedMinutes / estimate) * 100)) : null;
  const visibleComments = task.comments.filter((c) => !c.deletedAt);

  return (
    <>
      <PageHeader
        title={task.title}
        breadcrumbs={[{ label: "Tasks", href: "/tasks" }, { label: task.title }]}
        badges={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="task" status={task.status} />
            <StatusBadge kind="priority" status={task.priority} />
            {d.overdue ? <Badge tone="destructive">overdue</Badge> : null}
            <SampleBadge show={task.isSample} />
          </span>
        }
        actions={
          <>
            {d.moves.map((m) => (
              <TransitionButton
                key={m.to}
                taskId={task.id}
                move={m}
                variant={
                  m.to === "cancelled"
                    ? "outline"
                    : m.to === "approved" ||
                        m.to === "completed" ||
                        m.to === "ready_for_review" ||
                        m.to === "in_progress"
                      ? "default"
                      : "outline"
                }
                existingEvidence={{ note: task.evidenceNote, links: task.evidenceLinks }}
              />
            ))}
            {can.canEdit ? (
              <Button asChild variant="outline">
                <Link href={`/tasks/${task.id}/edit`}>Edit</Link>
              </Button>
            ) : null}
          </>
        }
      />

      {d.moves.some((m) => m.disabledReason) ? (
        <p className="-mt-4 mb-6 text-sm text-muted-foreground">
          {d.moves.find((m) => m.disabledReason)?.disabledReason}.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5 text-sm">
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Description
                </p>
                {task.description ? (
                  <p className="whitespace-pre-wrap">{task.description}</p>
                ) : (
                  <p className="text-muted-foreground">No description.</p>
                )}
              </div>
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Acceptance criteria
                </p>
                {task.acceptanceCriteria ? (
                  <ul className="list-disc space-y-1 pl-5">
                    {task.acceptanceCriteria
                      .split("\n")
                      .filter(Boolean)
                      .map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">
                    None set. Add criteria so the reviewer knows what “done” means.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Completion evidence</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              {task.evidenceNote || task.evidenceLinks.length ? (
                <div>
                  {task.evidenceNote ? (
                    <p className="whitespace-pre-wrap">{task.evidenceNote}</p>
                  ) : null}
                  {task.evidenceLinks.length ? (
                    <ul className="mt-2 flex flex-col gap-1">
                      {task.evidenceLinks.map((link) => (
                        <li key={link}>
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="inline-flex items-center gap-1 break-all text-primary hover:underline"
                          >
                            {link} <ExternalLink className="size-3 shrink-0" aria-hidden />
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : (
                <p className="text-muted-foreground">
                  Evidence is added when the task is submitted for review.
                </p>
              )}
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Paperclip className="size-3" aria-hidden /> Files ({task.attachments.length})
                </p>
                {task.attachments.length === 0 ? (
                  <p className="text-muted-foreground">No files attached.</p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {task.attachments.map((a) => (
                      <li
                        key={a.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                      >
                        <span className="min-w-0">
                          <a
                            href={`/api/attachments/${a.id}`}
                            className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
                          >
                            <Download className="size-3.5" aria-hidden />{" "}
                            <span className="truncate">{a.fileName}</span>
                          </a>
                          <span className="block text-xs text-muted-foreground">
                            {(Number(a.sizeBytes) / 1024).toFixed(0)} KB ·{" "}
                            {a.uploadedBy?.name ?? "someone"} · {formatDay(a.createdAt, tz)}
                          </span>
                        </span>
                        {can.canEdit || a.uploadedById === d.userId ? (
                          <RemoveAttachmentButton
                            taskId={task.id}
                            attachmentId={a.id}
                            name={a.fileName}
                          />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {can.canEdit ? (
                <UploadForm action={uploadAttachmentAction.bind(null, task.id)} />
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link2 className="size-4" aria-hidden /> Dependencies
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  This task waits for
                </p>
                {task.dependencies.length === 0 ? (
                  <p className="text-muted-foreground">
                    Nothing. It can start whenever it is assigned.
                  </p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {task.dependencies.map((dep) => (
                      <li
                        key={dep.dependsOnTaskId}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                      >
                        <Link
                          href={`/tasks/${dep.dependsOnTask.id}`}
                          className="font-medium hover:underline"
                        >
                          {dep.dependsOnTask.title}
                        </Link>
                        <span className="flex items-center gap-2">
                          <StatusBadge kind="task" status={dep.dependsOnTask.status} />
                          {can.canEdit ? (
                            <RemoveDependencyButton
                              taskId={task.id}
                              dependsOnTaskId={dep.dependsOnTaskId}
                              title={dep.dependsOnTask.title}
                            />
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {task.dependents.length > 0 ? (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Waiting for this task
                  </p>
                  <ul className="flex flex-col gap-1">
                    {task.dependents.map((x) => (
                      <li key={x.taskId}>
                        <Link href={`/tasks/${x.task.id}`} className="hover:underline">
                          {x.task.title}
                        </Link>{" "}
                        <span className="text-xs text-muted-foreground">
                          ({STATUS_LABELS[x.task.status as TaskStatusName]})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {can.canEdit ? (
                <DependencyForm
                  candidates={d.dependencyCandidates}
                  action={addDependencyAction.bind(null, task.id)}
                />
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Comments ({visibleComments.length})</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5">
              {visibleComments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No comments yet.</p>
              ) : (
                <ul className="grid gap-4">
                  {visibleComments.map((c) => (
                    <li key={c.id} className="text-sm">
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {c.author?.name ?? "Someone"}
                        </span>
                        <time dateTime={c.createdAt.toISOString()}>
                          {formatDateTime(c.createdAt)}
                        </time>
                        {c.editedAt ? <span>(edited)</span> : null}
                        {c.authorId === d.userId || can.canManage ? (
                          <DeleteCommentButton taskId={task.id} commentId={c.id} />
                        ) : null}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
                    </li>
                  ))}
                </ul>
              )}
              {can.canComment ? (
                <CommentForm action={addCommentAction.bind(null, task.id)} />
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="relative grid gap-4 border-l border-border pl-5">
                {task.events.map((e) => {
                  const line = describeEvent(e, d.userNames);
                  return (
                    <li key={e.id} className="text-sm">
                      <span
                        className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border border-background bg-muted-foreground/60"
                        aria-hidden
                      />
                      <p>
                        <span className="font-medium">{e.actor?.name ?? "Automation"}</span>{" "}
                        {line.text}
                      </p>
                      {line.detail ? (
                        <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">
                          “{line.detail}”
                        </p>
                      ) : null}
                      <time
                        className="text-xs text-muted-foreground"
                        dateTime={e.createdAt.toISOString()}
                      >
                        {formatDateTime(e.createdAt)}
                      </time>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Properties</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-border">
                <Row label="Client">
                  <Link href={`/clients/${task.client.id}`} className="hover:underline">
                    {task.client.name}
                  </Link>
                </Row>
                <Row label="Project">
                  {task.project ? (
                    <Link href={`/projects/${task.project.id}`} className="hover:underline">
                      {task.project.name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </Row>
                <Row label="Type">
                  <span className="capitalize">{task.type.replace(/_/g, " ")}</span>
                </Row>
                <Row label="Created by">
                  {task.reporter?.name ?? (task.source === "automation" ? "An automation" : "—")}
                </Row>
                <Row label="Assignee">
                  {task.assignee?.name ?? <span className="text-muted-foreground">Unassigned</span>}
                </Row>
                <Row label="Due">
                  {task.dueAt ? (
                    <span className={d.overdue ? "font-medium text-destructive" : undefined}>
                      {formatDay(task.dueAt, tz)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">No due date</span>
                  )}
                </Row>
                <Row label="Effort">
                  <div>
                    <p>
                      {formatEffort(d.loggedMinutes)} logged
                      {estimate ? <> of {formatEffort(estimate)} estimated</> : " (no estimate)"}
                    </p>
                    {progress !== null ? (
                      <div
                        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
                        role="img"
                        aria-label={`${progress}% of the estimate used`}
                      >
                        <div
                          className={`h-full rounded-full ${d.loggedMinutes > estimate ? "bg-destructive" : "bg-primary"}`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    ) : null}
                  </div>
                </Row>
                {task.labels.length ? (
                  <Row label="Labels">
                    <span className="flex flex-wrap gap-1">
                      {task.labels.map((l) => (
                        <Badge key={l} tone="outline">
                          {l}
                        </Badge>
                      ))}
                    </span>
                  </Row>
                ) : null}
                <Row label="Related content">
                  {task.contentItem ? (
                    <Link href="/content" className="hover:underline">
                      {task.contentItem.title}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </Row>
                <Row label="SEO issues">
                  {task.seoIssues.length ? (
                    <ul className="flex flex-col gap-1">
                      {task.seoIssues.map((i) => (
                        <li key={i.id} className="flex flex-wrap items-center gap-1.5">
                          <Link href="/seo" className="hover:underline">
                            {i.title}
                          </Link>{" "}
                          <StatusBadge kind="severity" status={i.severity} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </Row>
                <Row label="Created">{formatDateTime(task.createdAt)}</Row>
                <Row label="Updated">{formatDateTime(task.updatedAt)}</Row>
                {task.startedAt ? (
                  <Row label="Started">{formatDateTime(task.startedAt)}</Row>
                ) : null}
                {task.completedAt ? (
                  <Row label="Completed">{formatDateTime(task.completedAt)}</Row>
                ) : null}
              </dl>
              {can.canAssign || can.selfClaim ? (
                <div className="mt-4 border-t border-border pt-4">
                  <AssignForm
                    taskId={task.id}
                    assigneeId={task.assigneeId}
                    people={d.assignable}
                    userId={d.userId}
                    canAssign={can.canAssign}
                    selfClaim={can.selfClaim}
                  />
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Time</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              {task.timeEntries.length === 0 ? (
                <p className="text-muted-foreground">No time logged yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {task.timeEntries.map((t) => (
                    <li
                      key={t.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                    >
                      <span>
                        <span className="font-medium">
                          {formatEffort(Math.round(t.durationSeconds / 60))}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          · {t.user.name} · {formatDay(t.startedAt, "UTC")}
                        </span>
                        {t.note ? (
                          <span className="block text-xs text-muted-foreground">{t.note}</span>
                        ) : null}
                      </span>
                      {t.user.id === d.userId || can.canManage ? (
                        <DeleteTimeButton taskId={task.id} entryId={t.id} />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {can.canLogTime ? <LogTimeForm action={logTimeAction.bind(null, task.id)} /> : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
