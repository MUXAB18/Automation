import Link from "next/link";
import { CHANNEL_LIMITS, getContentDetail, preflightPublish, type Channel } from "@automation/db";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatDate } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { orNotFound } from "@/lib/guard";
import { requireSection } from "@/lib/sections";
import { requireActor } from "@/lib/session";
import {
  advanceAction,
  clientApprovalAction,
  commentAction,
  decideAction,
  manualPublishAction,
  removeMediaAction,
  restoreAction,
  retryPublishAction,
  saveVersionAction,
  scheduleAction,
  submitAction,
  unscheduleAction,
  uploadMediaAction,
} from "../actions";
import {
  CommentBox,
  Editor,
  ManualPublishForm,
  MediaUpload,
  RestoreButton,
  SchedulePanel,
  WorkflowButtons,
} from "./panels";

export const metadata = { title: "Content" };

const when = (d: Date | null) =>
  d
    ? `${formatDate(d)} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
    : "";

export default async function ContentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  await requireSection(actor, "content");
  const { id } = await params;
  const d = await orNotFound(getContentDetail(actor, id));
  const { item, can, client } = d;
  const channel = item.channel as Channel;
  const meta = (item.currentVersion?.metadata ?? {}) as {
    hashtags?: string[];
    seoTitle?: string;
    metaDescription?: string;
  };
  const pre =
    can.publish && ["approved", "failed"].includes(item.status)
      ? await preflightPublish(actor, id)
      : null;
  const status = item.status;
  const aiAuthored = item.currentVersion?.authorKind === "ai";

  return (
    <>
      <PageHeader
        title={item.title}
        description={`${client.name} · ${item.channel.replace("_", " ")}${item.project ? ` · ${item.project.name}` : ""}`}
        breadcrumbs={[{ label: "Content", href: "/content" }, { label: item.title }]}
        badges={<StatusBadge kind="content" status={status} />}
        actions={
          <Button variant="outline" asChild>
            <Link href="/content/ai">AI studio</Link>
          </Button>
        }
      />
      {aiAuthored ? (
        <p
          role="note"
          className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
        >
          The current version was written by AI. Its claims and figures are not verified facts:
          check them before approving.
        </p>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="grid gap-6">
          {item.brief ? (
            <Card>
              <CardHeader>
                <CardTitle>Brief</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap font-sans text-sm">{item.brief}</pre>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>
                {item.currentVersion ? `Version ${item.currentVersion.versionNo}` : "Draft"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Editor
                action={saveVersionAction.bind(null, id)}
                values={{
                  title: item.currentVersion?.title ?? item.title,
                  body: item.currentVersion?.body ?? "",
                  hashtags: (meta.hashtags ?? []).join(" "),
                  seoTitle: meta.seoTitle ?? "",
                  metaDescription: meta.metaDescription ?? "",
                }}
                channelLimit={CHANNEL_LIMITS[channel]}
                expectedVersionNo={item.currentVersion?.versionNo ?? 0}
                disabled={!can.edit}
                blog={item.type === "blog_post" || item.channel === "website"}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Media</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {d.assets.length === 0 ? (
                <p className="text-sm text-muted-foreground">No images or video attached.</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {d.assets.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{a.fileName}</span>
                        <span className="text-xs text-muted-foreground">
                          {a.kind} · {(Number(a.sizeBytes) / 1024 / 1024).toFixed(1)} MB
                          {a.altText ? ` · ${a.altText}` : " · no alt text"}
                        </span>
                      </span>
                      {can.edit ? (
                        <ConfirmDialog
                          triggerLabel="Remove"
                          triggerVariant="ghost"
                          title="Remove this file?"
                          description="It is taken off this post."
                          confirmLabel="Remove"
                          action={removeMediaAction}
                          fields={{ itemId: id, assetId: a.id }}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {can.edit ? <MediaUpload action={uploadMediaAction.bind(null, id)} /> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Comments</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {d.comments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No comments yet.</p>
              ) : (
                d.comments.map((c) => (
                  <div key={c.id} className="rounded-lg border border-border p-3 text-sm">
                    <p className="text-xs text-muted-foreground">
                      {c.author?.name ?? "Someone"} · {when(c.createdAt)}{" "}
                      {c.isChangeRequest ? <Badge tone="warning">changes requested</Badge> : null}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
                  </div>
                ))
              )}
              <CommentBox itemId={id} action={commentAction} />
            </CardContent>
          </Card>
        </div>

        <div className="grid h-fit gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Workflow</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              <p className="text-muted-foreground">
                Idea → Brief → Draft → Internal review
                {item.requiresClientApproval ? " → Client approval" : ""} → Scheduled → Published
              </p>
              {item.scheduledFor ? (
                <p>
                  <span className="text-muted-foreground">Planned for:</span>{" "}
                  {item.scheduledFor.toLocaleString("en-CA", {
                    timeZone: client.timezone,
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}{" "}
                  ({client.timezone})
                </p>
              ) : null}
              {["idea", "brief"].includes(status) && can.advance ? (
                <WorkflowButtons
                  itemId={id}
                  buttons={[
                    ...(status === "idea"
                      ? [{ label: "Move to brief", action: advanceAction, fields: { to: "brief" } }]
                      : []),
                    {
                      label: "Start the draft",
                      action: advanceAction,
                      fields: { to: "draft" },
                      variant: "default" as const,
                    },
                  ]}
                />
              ) : null}
              {can.submit ? (
                <WorkflowButtons
                  itemId={id}
                  notePlaceholder="Note for the reviewer (optional)"
                  buttons={[{ label: "Send for review", action: submitAction, variant: "default" }]}
                />
              ) : null}
              {can.decide ? (
                <WorkflowButtons
                  itemId={id}
                  buttons={[
                    {
                      label: "Approve",
                      action: decideAction,
                      fields: { decision: "approve" },
                      variant: "default",
                    },
                    {
                      label: "Request changes",
                      action: decideAction,
                      fields: { decision: "request_changes" },
                      needsNote: true,
                    },
                    {
                      label: "Reject",
                      action: decideAction,
                      fields: { decision: "reject" },
                      variant: "ghost",
                    },
                  ]}
                />
              ) : null}
              {(status === "in_review" || status === "client_approval") && !can.decide ? (
                <p className="text-muted-foreground">
                  Waiting for {status === "in_review" ? "an internal reviewer" : "the client"}. You
                  cannot approve a version you wrote.
                </p>
              ) : null}
              {["rejected", "cancelled", "changes_requested"].includes(status) && can.advance ? (
                <WorkflowButtons
                  itemId={id}
                  buttons={[
                    { label: "Reopen as draft", action: advanceAction, fields: { to: "reopen" } },
                  ]}
                />
              ) : null}
              {["idea", "brief", "draft", "changes_requested", "rejected"].includes(status) &&
              can.advance ? (
                <ConfirmDialog
                  triggerLabel={
                    item.requiresClientApproval ? "Client approval: on" : "Client approval: off"
                  }
                  triggerVariant="ghost"
                  title={
                    item.requiresClientApproval
                      ? "Stop requiring client approval?"
                      : "Require client approval?"
                  }
                  description="Decided before the content is sent for review."
                  confirmLabel="Change"
                  action={clientApprovalAction}
                  fields={{ itemId: id, required: String(!item.requiresClientApproval) }}
                />
              ) : null}
              {!["scheduled", "publishing", "published", "cancelled"].includes(status) &&
              can.advance ? (
                <ConfirmDialog
                  triggerLabel="Cancel content"
                  triggerVariant="ghost"
                  title="Cancel this content?"
                  description="It leaves the calendar. You can reopen it later."
                  confirmLabel="Cancel content"
                  destructive
                  action={advanceAction}
                  fields={{ itemId: id, to: "cancelled" }}
                />
              ) : null}
            </CardContent>
          </Card>

          {pre ? (
            <Card>
              <CardHeader>
                <CardTitle>Schedule</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                {pre.errors.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-5 text-destructive">
                    {pre.errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                ) : null}
                {pre.warnings.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                    {pre.warnings.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                ) : null}
                {pre.errors.length === 0 ? (
                  <SchedulePanel
                    itemId={id}
                    timezone={client.timezone}
                    scheduleAction={scheduleAction}
                    mode={pre.mode}
                    reasons={pre.directReasons}
                    accounts={pre.accounts}
                  />
                ) : null}
              </CardContent>
            </Card>
          ) : null}
          {status === "scheduled" && can.publish ? (
            <Card>
              <CardHeader>
                <CardTitle>Scheduled</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <WorkflowButtons
                  itemId={id}
                  buttons={[{ label: "Unschedule", action: unscheduleAction }]}
                />
                {d.jobs.length === 0 || d.jobs.every((j) => j.status === "cancelled") ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Published by hand? Record it here.
                    </p>
                    <ManualPublishForm itemId={id} action={manualPublishAction} />
                  </>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
          {(status === "failed" || d.jobs.some((j) => j.status === "needs_review")) &&
          can.publish ? (
            <Card>
              <CardHeader>
                <CardTitle>Needs attention</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                {d.jobs
                  .filter((j) => j.status === "failed" || j.status === "needs_review")
                  .map((j) => (
                    <div key={j.id} className="grid gap-2">
                      <p className="text-destructive">{j.lastError}</p>
                      {j.status === "failed" ? (
                        <WorkflowButtons
                          itemId={id}
                          buttons={[
                            {
                              label: "Retry publishing",
                              action: retryPublishAction,
                              fields: { jobId: j.id },
                            },
                          ]}
                        />
                      ) : (
                        <p className="text-muted-foreground">
                          Check the account before trying again: the post may exist.
                        </p>
                      )}
                    </div>
                  ))}
                <p className="text-xs text-muted-foreground">
                  If direct publishing keeps failing, post it by hand and record it here.
                </p>
                {d.jobs.every((j) => j.status !== "needs_review" && j.status !== "succeeded") ? (
                  <ManualPublishForm itemId={id} action={manualPublishAction} />
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Versions</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border text-sm">
                {d.versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-medium">v{v.versionNo}</span>{" "}
                      {v.authorKind === "ai" ? <Badge tone="warning">AI</Badge> : null}
                      <span className="block text-xs text-muted-foreground">
                        {v.createdBy?.name ?? "System"} · {when(v.createdAt)}
                        {v.changeNote ? ` · ${v.changeNote}` : ""}
                      </span>
                    </span>
                    {can.edit && v.versionNo !== item.currentVersion?.versionNo ? (
                      <RestoreButton itemId={id} versionNo={v.versionNo} action={restoreAction} />
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Approvals</CardTitle>
            </CardHeader>
            <CardContent>
              {d.approvals.length === 0 ? (
                <p className="text-sm text-muted-foreground">Not reviewed yet.</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {d.approvals.map((a) => (
                    <li key={a.id} className="py-2">
                      <span className="capitalize">{a.stage}</span> review of v
                      {a.contentVersion.versionNo}:{" "}
                      <span className="font-medium">{a.status.replace("_", " ")}</span>
                      {a.decidedBy ? ` by ${a.decidedBy.name}` : ""}
                      {a.decisionNote ? (
                        <span className="block text-xs text-muted-foreground">
                          {a.decisionNote}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Publishing history</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {d.jobs.length === 0 && d.manual.length === 0 ? (
                <p className="text-muted-foreground">Nothing published yet.</p>
              ) : null}
              {d.jobs.map((j) => (
                <div key={j.id} className="rounded-lg border border-border p-2">
                  <p>
                    <StatusBadge kind="publishing" status={j.status} /> v
                    {j.contentVersion.versionNo} via{" "}
                    {j.integrationAccount.displayName ?? "provider"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {j.scheduledFor ? `For ${when(j.scheduledFor)} · ` : ""}
                    {j.attempts} attempt{j.attempts === 1 ? "" : "s"}
                    {j.publishedPost ? ` · post ${j.publishedPost.externalPostId}` : ""}
                  </p>
                  {j.lastError ? <p className="text-xs text-destructive">{j.lastError}</p> : null}
                </div>
              ))}
              {d.manual.map((m) => (
                <div key={m.id} className="rounded-lg border border-border p-2">
                  <p>Published by hand by {m.markedBy.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {when(m.publishedAt)}
                    {m.note ? ` · ${m.note}` : ""}
                  </p>
                  {m.publishedUrl ? (
                    <a
                      href={m.publishedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary underline"
                    >
                      {m.publishedUrl}
                    </a>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border text-xs">
                {d.events.map((e) => (
                  <li key={e.id} className="py-2">
                    {e.fromStatus ? `${e.fromStatus.replace(/_/g, " ")} → ` : ""}
                    <span className="font-medium">{e.toStatus.replace(/_/g, " ")}</span> ·{" "}
                    {e.actor?.name ?? "System"} · {when(e.createdAt)}
                    {e.note ? <span className="block text-muted-foreground">{e.note}</span> : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
