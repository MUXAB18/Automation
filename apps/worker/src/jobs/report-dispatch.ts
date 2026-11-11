import { aiRuntimeFromEnv, type WorkerEnv } from "@automation/config";
import {
  claimNextDelivery,
  finishDelivery,
  generateReport,
  loadDeliveryJob,
  markDeliveryRequestSent,
  nextGeneratingReport,
  reapStaleDeliveries,
  runDueSchedules,
  type AiDeps,
  type DeliveryOutcome,
} from "@automation/db";
import { MailError, createMailer } from "@automation/integrations";
import { renderReportPdf, renderReportText } from "@automation/reports";
import { providerFromEnv } from "./ai-dispatch";

export const REPORT_QUEUE = "report-engine";
const MAX_REPORTS_PER_TICK = 5;
const MAX_DELIVERIES_PER_TICK = 20;

type Mailer = ReturnType<typeof createMailer>;
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "report";

/** Send one claimed delivery. Never throws. The request is stamped as sent immediately before the provider call. */
export async function deliverOne(id: string, mailer: Mailer): Promise<DeliveryOutcome | null> {
  const job = await loadDeliveryJob(id);
  if (!job) return null;
  let pdf: Buffer;
  try {
    pdf = await renderReportPdf(job.view);
  } catch {
    const outcome: DeliveryOutcome = { kind: "retry", message: "The PDF could not be created." };
    await finishDelivery(id, outcome);
    return outcome;
  }
  const text = [
    "The full report is attached as a PDF. A plain-text copy follows.",
    "",
    renderReportText(job.view),
  ].join("\n");
  let outcome: DeliveryOutcome;
  try {
    await markDeliveryRequestSent(id);
    const sent = await mailer.send({
      to: job.recipient,
      subject: job.view.title,
      text,
      idempotencyKey: job.idempotencyKey,
      attachments: [
        {
          filename: `${slug(job.view.clientName)}-${job.view.periodStart}-to-${job.view.periodEnd}.pdf`,
          content: pdf,
          contentType: "application/pdf",
        },
      ],
    });
    outcome = { kind: "sent", messageId: sent.messageId };
  } catch (error) {
    outcome =
      error instanceof MailError
        ? { kind: error.kind, message: error.safeMessage }
        : { kind: "unknown", message: "The email could not be confirmed." };
  }
  await finishDelivery(id, outcome);
  return outcome;
}

/** One tick: end stuck deliveries, create due scheduled reports, generate waiting reports, send waiting emails. */
export async function runReportTick(env: WorkerEnv, deps: { mailer?: Mailer; ai?: AiDeps } = {}) {
  const mailer =
    deps.mailer ??
    createMailer({
      transport: env.MAIL_TRANSPORT,
      apiKey: env.EMAIL_API_KEY,
      from: env.EMAIL_FROM,
      production: process.env.NODE_ENV === "production",
    });
  const ai =
    deps.ai === undefined
      ? { provider: providerFromEnv(env), config: aiRuntimeFromEnv(env) }
      : deps.ai;
  const reaped = await reapStaleDeliveries();
  const schedules = await runDueSchedules();
  let generated = 0;
  for (; generated < MAX_REPORTS_PER_TICK; generated++) {
    const id = await nextGeneratingReport();
    if (!id) break;
    await generateReport(id, ai);
  }
  let sent = 0;
  for (let i = 0; i < MAX_DELIVERIES_PER_TICK; i++) {
    const id = await claimNextDelivery();
    if (!id) break;
    if ((await deliverOne(id, mailer))?.kind === "sent") sent++;
  }
  return { reaped, scheduled: schedules.created, generated, sent };
}
