import { recordAudit } from "../audit";
import type { Prisma } from "../generated/client";
import { getUnscopedPrisma } from "../unsafe";
import { SECTION_TITLE, type ReportView, type SectionKey } from "./document";
import { ymd } from "./metrics";

/**
 * Email delivery, worker side. A delivery is one row per report and recipient (unique), claimed with SKIP LOCKED.
 * `request_sent_at` is stamped just before the mail provider is called: a delivery that is still "sending" with that
 * stamp has an unknown outcome and goes to `needs_review` instead of being sent again behind anyone's back. Transient
 * failures retry with backoff; the provider call also carries an idempotency key, so a retry cannot double-send.
 */

const prisma = () => getUnscopedPrisma();
export const MAX_DELIVERY_ATTEMPTS = 4;
const RETRY_BASE_SECONDS = 300;
const STALE_MS = 15 * 60_000;

export async function claimNextDelivery(): Promise<string | null> {
  const rows = await prisma().$queryRaw<{ id: string }[]>`
    UPDATE report_deliveries SET status = 'sending', started_at = now(), attempts = attempts + 1, updated_at = now()
    WHERE id = (SELECT d.id FROM report_deliveries d JOIN reports r ON r.id = d.report_id
                WHERE d.status = 'pending' AND d.channel = 'email' AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= now()) AND r.status IN ('approved', 'delivered')
                ORDER BY d.created_at LIMIT 1 FOR UPDATE OF d SKIP LOCKED)
    RETURNING id`;
  return rows[0]?.id ?? null;
}

export async function loadReportView(reportId: string): Promise<ReportView | null> {
  const r = await prisma().report.findUnique({
    where: { id: reportId },
    include: {
      client: { select: { name: true, timezone: true } },
      reportSections: { orderBy: { position: "asc" } },
    },
  });
  if (!r) return null;
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    clientName: r.client.name,
    timezone: r.client.timezone,
    periodStart: ymd(r.periodStart),
    periodEnd: ymd(r.periodEnd),
    generatedAt: r.generatedAt?.toISOString() ?? null,
    revision: r.revision,
    sections: r.reportSections.map((s) => ({
      key: s.key as SectionKey,
      title: SECTION_TITLE[s.key as SectionKey] ?? s.title,
      content: s.content as Record<string, unknown>,
      aiGenerated: s.aiGenerated,
    })),
  };
}

export type DeliveryJob = {
  id: string;
  reportId: string;
  recipient: string;
  attempt: number;
  resendCount: number;
  idempotencyKey: string;
  view: ReportView;
};

export async function loadDeliveryJob(id: string): Promise<DeliveryJob | null> {
  const d = await prisma().reportDelivery.findUnique({ where: { id } });
  if (!d || d.status !== "sending") return null;
  const view = await loadReportView(d.reportId);
  if (!view) return null;
  // The key is stable across automatic retries of the same send and changes only when a person asks for a resend.
  return {
    id: d.id,
    reportId: d.reportId,
    recipient: d.recipient,
    attempt: d.attempts,
    resendCount: d.resendCount,
    idempotencyKey: `report-delivery:${d.id}:${d.resendCount}`,
    view,
  };
}

export async function markDeliveryRequestSent(id: string): Promise<void> {
  await prisma().reportDelivery.update({ where: { id }, data: { requestSentAt: new Date() } });
}

export type DeliveryOutcome =
  | { kind: "sent"; messageId: string | null }
  /** The provider refused for a reason that may pass (rate limit, outage): try again later. */
  | { kind: "retry"; message: string }
  /** The provider refused for good (bad address, rejected content). */
  | { kind: "failed"; message: string }
  /** The request may have reached the provider. */
  | { kind: "unknown"; message: string };

export async function finishDelivery(id: string, outcome: DeliveryOutcome): Promise<void> {
  await prisma().$transaction(async (tx) => {
    const d = await tx.reportDelivery.findUniqueOrThrow({ where: { id } });
    if (d.status !== "sending") return; // already settled
    const attempt = (
      status: "sent" | "failed" | "pending" | "needs_review",
      error?: string,
      messageId?: string | null,
    ) =>
      tx.reportDeliveryAttempt.create({
        data: {
          agencyId: d.agencyId,
          clientId: d.clientId,
          deliveryId: id,
          attemptNo: d.attempts,
          status,
          error: error?.slice(0, 400) ?? null,
          providerMessageId: messageId ?? null,
        },
      });
    const audit = (action: string, after: Prisma.InputJsonObject) =>
      recordAudit(tx, {
        actorUserId: null,
        agencyId: d.agencyId,
        clientId: d.clientId,
        action,
        entityType: "report",
        entityId: d.reportId,
        after,
      });

    if (outcome.kind === "sent") {
      await tx.reportDelivery.update({
        where: { id },
        data: {
          status: "sent",
          sentAt: new Date(),
          providerMessageId: outcome.messageId,
          error: null,
          nextAttemptAt: null,
        },
      });
      await attempt("sent", undefined, outcome.messageId);
      await tx.report.updateMany({
        where: { id: d.reportId, status: "approved" },
        data: { status: "delivered" },
      });
      return audit("report.delivered", { recipient: d.recipient });
    }
    if (outcome.kind === "retry" && d.attempts < MAX_DELIVERY_ATTEMPTS) {
      const seconds = RETRY_BASE_SECONDS * 2 ** (d.attempts - 1);
      await tx.$executeRaw`UPDATE report_deliveries SET status = 'pending', error = ${outcome.message.slice(0, 400)}, request_sent_at = NULL, next_attempt_at = now() + make_interval(secs => ${seconds}), updated_at = now() WHERE id = ${id}`;
      return void (await attempt("pending", outcome.message));
    }
    if (outcome.kind === "unknown") {
      await tx.reportDelivery.update({
        where: { id },
        data: { status: "needs_review", error: outcome.message.slice(0, 400) },
      });
      await attempt("needs_review", outcome.message);
      await notifyFailure(tx, d, "needs a manual check");
      return audit("report.delivery_needs_review", { recipient: d.recipient });
    }
    const message =
      outcome.kind === "retry"
        ? `Gave up after ${d.attempts} attempts: ${outcome.message}`
        : outcome.message;
    await tx.reportDelivery.update({
      where: { id },
      data: { status: "failed", error: message.slice(0, 400), nextAttemptAt: null },
    });
    await attempt("failed", message);
    await notifyFailure(tx, d, "failed");
    return audit("report.delivery_failed", { recipient: d.recipient });
  });
}

async function notifyFailure(
  tx: Prisma.TransactionClient,
  d: { agencyId: string; clientId: string; reportId: string; recipient: string },
  what: string,
) {
  const report = await tx.report.findUnique({
    where: { id: d.reportId },
    select: { title: true, createdById: true, approvedById: true },
  });
  const people = new Set(
    [report?.createdById, report?.approvedById].filter((x): x is string => !!x),
  );
  if (people.size === 0) return;
  await tx.notification.createMany({
    data: [...people].map((userId) => ({
      agencyId: d.agencyId,
      clientId: d.clientId,
      userId,
      type: "report.delivery_failed",
      title: `Report email to ${d.recipient} ${what}`,
      body: report?.title ?? null,
      entityType: "report",
      entityId: d.reportId,
    })),
  });
}

/** A delivery stuck "sending" (worker crash): back to the queue if nothing was sent, otherwise a person checks. */
export async function reapStaleDeliveries(now = new Date()): Promise<number> {
  const stale = await prisma().reportDelivery.findMany({
    where: { status: "sending", startedAt: { lt: new Date(now.getTime() - STALE_MS) } },
    select: { id: true, requestSentAt: true },
  });
  for (const d of stale) {
    if (d.requestSentAt)
      await finishDelivery(d.id, {
        kind: "unknown",
        message: "The worker stopped while sending. Check whether the recipient received it.",
      });
    else
      await prisma().reportDelivery.updateMany({
        where: { id: d.id, status: "sending" },
        data: { status: "pending", nextAttemptAt: null },
      });
  }
  return stale.length;
}
