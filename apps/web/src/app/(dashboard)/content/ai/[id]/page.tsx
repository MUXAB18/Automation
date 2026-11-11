import { AI_TASKS, TASK_LABEL, getAiJob, type AiTask } from "@automation/db";
import { RefreshOnInterval } from "@/components/refresh-on-interval";
import { formatDate } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { orNotFound } from "@/lib/guard";
import { requireActor } from "@/lib/session";
import { JobActions } from "../job-actions";
import { OutputView } from "../output-view";

export const metadata = { title: "AI generation" };

export default async function AiJobPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const job = await orNotFound(getAiJob(actor, id));
  const task = (AI_TASKS as readonly string[]).includes(job.task) ? (job.task as AiTask) : null;
  const output = job.output as {
    result: Record<string, unknown>;
    warnings: string[];
    disclaimer: string;
  } | null;
  const refs = job.inputRefs as {
    brandGuidelineId: string | null;
    brandVersion: number | null;
    sourceIds: string[];
  };
  const input = Object.fromEntries(
    Object.entries(job.input as Record<string, unknown>).filter(([k]) => !k.startsWith("_")),
  );
  const savable =
    !!task && ["blog_draft", "social_captions", "repurpose", "content_brief"].includes(task);
  const waiting = job.status === "queued" || job.status === "running";

  return (
    <>
      {waiting ? <RefreshOnInterval seconds={3} /> : null}
      <PageHeader
        title={task ? TASK_LABEL[task] : job.task}
        description={`${job.client.name}${job.project ? ` · ${job.project.name}` : ""}`}
        breadcrumbs={[
          { label: "Content", href: "/content" },
          { label: "AI studio", href: "/content/ai" },
          { label: "Generation" },
        ]}
        badges={<StatusBadge kind="run" status={job.status} />}
      />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Result</CardTitle>
            </CardHeader>
            <CardContent>
              {waiting ? (
                <p className="text-sm text-muted-foreground">
                  {job.status === "queued"
                    ? "Waiting for the worker. This page updates by itself."
                    : "Generating…"}
                  {job.attempt > 1 ? ` (attempt ${job.attempt})` : ""}
                </p>
              ) : null}
              {job.status === "failed" ? (
                <p className="text-sm text-destructive">{job.error ?? "The generation failed."}</p>
              ) : null}
              {job.status === "cancelled" ? (
                <p className="text-sm text-muted-foreground">Cancelled.</p>
              ) : null}
              {job.status === "queued" && job.error ? (
                <p className="mt-2 text-xs text-muted-foreground">Last attempt: {job.error}</p>
              ) : null}
              {output && task ? <OutputView task={task} output={output} /> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <JobActions
                jobId={job.id}
                status={job.status}
                task={job.task}
                canSave={savable}
                captionCount={
                  Array.isArray((output?.result as { captions?: unknown[] } | undefined)?.captions)
                    ? (output!.result as { captions: unknown[] }).captions.length
                    : 0
                }
              />
              {job.reviewOutcome ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Review:{" "}
                  <span className="font-medium text-foreground">
                    {job.reviewOutcome.replace("_", " ")}
                  </span>
                  {job.reviewerFeedback ? ` — ${job.reviewerFeedback}` : ""}
                </p>
              ) : null}
              {job.contentVersions.length > 0 ? (
                <p className="mt-2 text-sm">
                  Saved as a draft:{" "}
                  {job.contentVersions.map((v) => (
                    <a
                      key={v.id}
                      className="text-primary underline"
                      href={`/content/${v.contentItemId}`}
                    >
                      version {v.versionNo}
                    </a>
                  ))}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p>
              <span className="text-muted-foreground">Provider and model:</span> {job.provider} ·{" "}
              {job.model}
            </p>
            <p>
              <span className="text-muted-foreground">Prompt template:</span> {job.promptVersion}
            </p>
            <p>
              <span className="text-muted-foreground">Tokens:</span>{" "}
              {job.inputTokens != null
                ? `${job.inputTokens} in / ${job.outputTokens} out`
                : "not reported"}
            </p>
            <p>
              <span className="text-muted-foreground">Estimated cost:</span>{" "}
              {job.estimatedCostMicros != null
                ? `$${(Number(job.estimatedCostMicros) / 1e6).toFixed(4)} (estimate)`
                : "no price known"}
            </p>
            <p>
              <span className="text-muted-foreground">Requested by:</span>{" "}
              {job.requestedBy?.name ?? "System"}
            </p>
            <p>
              <span className="text-muted-foreground">Requested:</span> {formatDate(job.createdAt)}
            </p>
            <p>
              <span className="text-muted-foreground">Finished:</span>{" "}
              {formatDate(job.finishedAt) ?? "Not yet"}
            </p>
            <p>
              <span className="text-muted-foreground">Brand guideline:</span>{" "}
              {refs.brandGuidelineId ? `version ${refs.brandVersion}` : "none"}
            </p>
            <p>
              <span className="text-muted-foreground">Approved sources used:</span>{" "}
              {refs.sourceIds.length}
            </p>
            <details>
              <summary className="cursor-pointer text-muted-foreground">Request</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words text-xs">
                {JSON.stringify(input, null, 2)}
              </pre>
            </details>
            {job.regenerations.length ? (
              <p className="text-xs text-muted-foreground">
                Regenerated {job.regenerations.length}×
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
