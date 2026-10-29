import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardCheck, ExternalLink } from "lucide-react";
import { getReviewQueue, getTaskCounts } from "@automation/db";
import { Pagination } from "@/components/pagination";
import { EmptyState, SampleBadge } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { TransitionButton } from "@/components/tasks/transition-dialog";
import { formatDay } from "@/lib/format";
import { getScope } from "@/lib/scope";
import { flat, page, type RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Review queue" };

export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const actor = await requireActor();
  const raw = await searchParams;
  const scope = await getScope(actor);
  // Only people who can review anything see this page.
  const counts = await getTaskCounts(actor, {
    clientId: scope.clientId,
    projectId: scope.projectId,
  });
  if (!counts.canReview) notFound();
  const queue = await getReviewQueue(actor, {
    clientId: scope.clientId,
    projectId: scope.projectId,
    page: page(raw.page),
  });

  if (queue.total === 0) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title="Nothing is waiting for review"
        description="Tasks that people submit for review appear here, oldest first."
      />
    );
  }
  return (
    <>
      <p className="mb-4 max-w-prose text-sm text-muted-foreground">
        Oldest requests first. Check the evidence against the acceptance criteria, then approve or
        send the task back with what needs to change.
      </p>
      <ul className="grid gap-4">
        {queue.rows.map((t) => (
          <li key={t.id}>
            <Card>
              <CardContent className="grid gap-4 pt-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/tasks/${t.id}`}
                      className="flex flex-wrap items-center gap-2 text-base font-semibold hover:underline"
                    >
                      {t.title} <SampleBadge show={t.isSample} />
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t.client.name}
                      {t.project ? ` · ${t.project.name}` : ""} · by {t.assignee?.name ?? "nobody"}{" "}
                      · submitted{" "}
                      {t.reviewRequestedAt
                        ? formatDay(t.reviewRequestedAt, t.client.timezone)
                        : "—"}
                      {t.dueAt ? ` · due ${formatDay(t.dueAt, t.client.timezone)}` : ""}
                    </p>
                  </div>
                  {t.overdue ? <Badge tone="destructive">overdue</Badge> : null}
                </div>

                {t.acceptanceCriteria ? (
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Acceptance criteria
                    </p>
                    <p className="whitespace-pre-wrap text-sm">{t.acceptanceCriteria}</p>
                  </div>
                ) : null}
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Evidence
                  </p>
                  {t.evidenceNote ? (
                    <p className="whitespace-pre-wrap text-sm">{t.evidenceNote}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No note{t._count.attachments ? ", see the attached files" : ""}.
                    </p>
                  )}
                  {t.evidenceLinks.length > 0 ? (
                    <ul className="mt-2 flex flex-col gap-1 text-sm">
                      {t.evidenceLinks.map((link) => (
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

                <div className="flex flex-wrap items-center gap-2">
                  {t.ownWork ? (
                    <p className="text-sm text-muted-foreground">
                      You did this work, so someone else needs to review it.
                    </p>
                  ) : (
                    <>
                      <TransitionButton
                        taskId={t.id}
                        variant="default"
                        move={{ to: "approved", label: "Approve", needs: null }}
                      />
                      <TransitionButton
                        taskId={t.id}
                        move={{ to: "changes_requested", label: "Request changes", needs: "note" }}
                      />
                    </>
                  )}
                  <Link
                    href={`/tasks/${t.id}`}
                    className="ml-auto text-sm text-primary hover:underline"
                  >
                    Open task
                  </Link>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
      <Pagination
        page={queue.page}
        pageCount={queue.pageCount}
        total={queue.total}
        searchParams={flat(raw)}
        basePath="/tasks/review"
      />
    </>
  );
}
