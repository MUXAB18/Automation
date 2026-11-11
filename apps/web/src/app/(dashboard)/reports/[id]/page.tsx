import Link from "next/link";
import { getReport } from "@automation/db";
import { formatDate } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { ReportDocument } from "@/components/reports/report-document";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshOnInterval } from "@/components/refresh-on-interval";
import { orNotFound } from "@/lib/guard";
import { requireSection } from "@/lib/sections";
import { requireActor } from "@/lib/session";
import { resendAction, retryReportAction, reviewReportAction, sendReportAction } from "../actions";
import { ReviewPanel, SendForm, SimpleButton } from "../panels";

export const metadata = { title: "Report" };

const when = (d: Date | null) =>
  d
    ? `${formatDate(d)} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
    : "";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  await requireSection(actor, "reports");
  const { id } = await params;
  const d = await orNotFound(getReport(actor, id));
  const { report, view } = d;
  const sending = d.deliveries.some((x) => ["pending", "sending"].includes(x.status));
  return (
    <>
      {report.status === "generating" || sending ? <RefreshOnInterval seconds={5} /> : null}
      <PageHeader
        title={view.title}
        description={`${view.clientName} · ${view.periodStart} to ${view.periodEnd}${view.revision > 1 ? ` · revision ${view.revision}` : ""}`}
        breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: view.title }]}
        badges={<StatusBadge kind="report" status={report.status} />}
        actions={
          report.status !== "generating" && report.status !== "failed" ? (
            <Button variant="outline" asChild>
              <a href={`/reports/${id}/pdf`}>Download PDF</a>
            </Button>
          ) : null
        }
      />
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div>
          {report.status === "generating" ? (
            <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              The worker is building this report. This page updates by itself.
            </p>
          ) : null}
          {report.status === "failed" ? (
            <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              {report.error ?? "The report could not be generated."}
            </p>
          ) : null}
          {view.sections.length > 0 ? <ReportDocument view={view} /> : null}
        </div>
        <div className="grid h-fit gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Review</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <p>
                <span className="text-muted-foreground">Created:</span> {report.source}
                {report.createdBy ? ` by ${report.createdBy}` : ""}
              </p>
              {report.approvedBy ? (
                <p>
                  <span className="text-muted-foreground">Approved by:</span> {report.approvedBy}{" "}
                  {when(report.approvedAt)}
                </p>
              ) : null}
              {report.reviewNote ? (
                <p className="text-muted-foreground">Last note: {report.reviewNote}</p>
              ) : null}
              {d.can.approve ? (
                <ReviewPanel reportId={id} action={reviewReportAction} />
              ) : report.status === "ready" ? (
                <p className="text-muted-foreground">
                  Waiting for a reviewer. You cannot approve a report you requested.
                </p>
              ) : null}
              {report.status === "failed" && d.can.generate ? (
                <SimpleButton
                  label="Generate again"
                  action={retryReportAction}
                  fields={{ reportId: id }}
                  variant="default"
                />
              ) : null}
              {report.status === "draft" ? (
                <p className="text-muted-foreground">
                  Sent back for changes. Generate a new revision from the reports list.
                </p>
              ) : null}
            </CardContent>
          </Card>
          {["approved", "delivered"].includes(report.status) && d.can.generate ? (
            <Card>
              <CardHeader>
                <CardTitle>Send by email</CardTitle>
              </CardHeader>
              <CardContent>
                <SendForm reportId={id} action={sendReportAction} defaults="" />
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Delivery history</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {d.deliveries.length === 0 ? (
                <p className="text-muted-foreground">Not emailed yet.</p>
              ) : (
                d.deliveries.map((x) => (
                  <div key={x.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{x.recipient}</span>
                      <StatusBadge kind="delivery" status={x.status} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {x.attempts} attempt{x.attempts === 1 ? "" : "s"}
                      {x.resendCount ? ` · resent ${x.resendCount}×` : ""}
                      {x.sentAt ? ` · sent ${when(x.sentAt)}` : ""}
                      {x.nextAttemptAt && x.status === "pending"
                        ? ` · next try ${when(x.nextAttemptAt)}`
                        : ""}
                    </p>
                    {x.error ? <p className="text-xs text-destructive">{x.error}</p> : null}
                    <ul className="mt-1 text-xs text-muted-foreground">
                      {x.reportDeliveryAttempts.map((a) => (
                        <li key={a.id}>
                          #{a.attemptNo} {a.status.replace("_", " ")} · {when(a.createdAt)}
                          {a.error ? ` · ${a.error}` : ""}
                        </li>
                      ))}
                    </ul>
                    {d.can.generate && !["pending", "sending"].includes(x.status) ? (
                      <div className="mt-2">
                        <SimpleButton
                          label={
                            x.status === "needs_review"
                              ? "Resend (I checked it was not received)"
                              : "Resend"
                          }
                          action={resendAction}
                          fields={{
                            deliveryId: x.id,
                            reportId: id,
                            ...(x.status === "needs_review" ? { confirm: "yes" } : {}),
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Frozen figures</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1 text-xs text-muted-foreground">
              <p>
                This report was built from these stored snapshots, so it can be reproduced exactly
                later.
              </p>
              {report.snapshots.map((s) => (
                <p key={s.key} className="flex justify-between gap-2">
                  <span>{s.key}</span>
                  <code>{s.dataHash.slice(0, 12)}</code>
                </p>
              ))}
            </CardContent>
          </Card>
          <p className="text-xs">
            <Link href="/reports/schedule" className="text-primary underline">
              Schedule and template
            </Link>
          </p>
        </div>
      </div>
    </>
  );
}
