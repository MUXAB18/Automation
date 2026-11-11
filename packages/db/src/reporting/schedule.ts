import { z } from "zod";
import { requirePermission, type Actor } from "../access";
import { recordAudit } from "../audit";
import { ValidationError } from "../errors";
import { getUnscopedPrisma } from "../unsafe";
import { zonedDay } from "../time-zone";
import { createReportRecord, normalizeEmail } from "./report";
import { isDay } from "./date";
import { DEFAULT_INTERVAL_DAYS, latestDuePeriod, nextPeriodAfter } from "./periods";

const prisma = () => getUnscopedPrisma();

const scheduleSchema = z.object({
  enabled: z.coerce.boolean().default(false),
  intervalDays: z.coerce
    .number()
    .int()
    .min(1, "At least 1 day")
    .max(92, "At most 92 days")
    .default(DEFAULT_INTERVAL_DAYS),
  anchorDate: z.string().refine(isDay, "Choose a date").optional(),
  sendHour: z.coerce.number().int().min(0).max(23).default(9),
  recipients: z.array(z.string()).max(20, "At most 20 recipients").default([]),
  deliverOnApproval: z.coerce.boolean().default(true),
});

export async function getSchedule(actor: Actor, clientId: string) {
  const ctx = await requirePermission(actor, clientId, "report.generate");
  const client = await prisma().client.findUniqueOrThrow({
    where: { id: clientId },
    select: { timezone: true, reportEmail: true, reportIntervalDays: true },
  });
  const s = await ctx.db.reportSchedule.findFirst({});
  return {
    timezone: client.timezone,
    schedule: s ?? {
      enabled: false,
      intervalDays: client.reportIntervalDays || DEFAULT_INTERVAL_DAYS,
      anchorDate: null,
      sendHour: 9,
      recipients: client.reportEmail ? [client.reportEmail] : [],
      deliverOnApproval: true,
      nextRunAt: null,
      lastPeriodEnd: null,
    },
  };
}

/** Save the schedule. The next run is computed once here, in the client's time zone, and never by the viewer's clock. */
export async function saveSchedule(
  actor: Actor,
  clientId: string,
  raw: z.input<typeof scheduleSchema>,
  now = new Date(),
) {
  const ctx = await requirePermission(actor, clientId, "report.generate");
  const parsed = scheduleSchema.safeParse(raw);
  if (!parsed.success)
    throw new ValidationError(
      Object.fromEntries(parsed.error.issues.map((i) => [i.path.join(".") || "form", [i.message]])),
    );
  const v = parsed.data;
  const recipients: string[] = [];
  for (const r of v.recipients) {
    const e = normalizeEmail(r);
    if (!e) continue;
    if (!z.email().safeParse(e).success)
      throw new ValidationError({ recipients: [`"${r}" is not an email address`] });
    if (!recipients.includes(e)) recipients.push(e);
  }
  if (v.enabled && v.deliverOnApproval && recipients.length === 0)
    throw new ValidationError({
      recipients: ["Add a recipient, or turn off sending after approval"],
    });
  const client = await prisma().client.findUniqueOrThrow({
    where: { id: clientId },
    select: { timezone: true },
  });
  const anchor = v.anchorDate ?? zonedDay(now, client.timezone);
  const next = v.enabled
    ? nextPeriodAfter(anchor, v.intervalDays, v.sendHour, client.timezone, now)
    : null;
  await prisma().$transaction(async (tx) => {
    const data = {
      enabled: v.enabled,
      intervalDays: v.intervalDays,
      anchorDate: new Date(`${anchor}T00:00:00Z`),
      sendHour: v.sendHour,
      recipients,
      deliverOnApproval: v.deliverOnApproval,
      nextRunAt: next?.runAt ?? null,
      updatedById: actor.userId,
      lastPeriodEnd: null,
    };
    await tx.reportSchedule.upsert({
      where: { clientId },
      update: data,
      create: { ...data, agencyId: ctx.agencyId, clientId },
    });
    await tx.client.update({
      where: { id: clientId },
      data: { reportIntervalDays: v.intervalDays },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId,
      action: "report.schedule_saved",
      entityType: "client",
      entityId: clientId,
      after: { enabled: v.enabled, intervalDays: v.intervalDays, recipients: recipients.length },
    });
  });
  return { nextRunAt: next?.runAt ?? null, firstPeriod: next?.period ?? null };
}

/**
 * Worker: create the report of every schedule that is due. The "now" is the database clock (the same one the
 * `next_run_at` comparison uses). Creating the report is idempotent (unique client, period and revision), and the
 * schedule only advances with a compare-and-set, so two workers or a repeated tick produce one report.
 */
export async function runDueSchedules(): Promise<{ created: number; skipped: number }> {
  const dbNow = (await prisma().$queryRaw<{ now: Date }[]>`SELECT now() AS now`)[0]!.now;
  const due = await prisma().$queryRaw<{ id: string }[]>`
    SELECT s.id FROM report_schedules s JOIN clients c ON c.id = s.client_id
    WHERE s.enabled AND s.next_run_at IS NOT NULL AND s.next_run_at <= now() AND c.status = 'active'`;
  let created = 0,
    skipped = 0;
  for (const { id } of due) {
    const s = await prisma().reportSchedule.findUnique({
      where: { id },
      include: { client: { select: { timezone: true } } },
    });
    if (!s?.nextRunAt) continue;
    const anchor = s.anchorDate.toISOString().slice(0, 10);
    const period = latestDuePeriod(anchor, s.intervalDays, s.sendHour, s.client.timezone, dbNow);
    try {
      if (period && (!s.lastPeriodEnd || period.end > s.lastPeriodEnd.toISOString().slice(0, 10))) {
        const r = await createReportRecord({
          agencyId: s.agencyId,
          clientId: s.clientId,
          start: period.start,
          end: period.end,
          source: "scheduled",
          createdById: null,
        });
        if (r.created) created++;
        else skipped++;
      } else skipped++;
      const next = nextPeriodAfter(anchor, s.intervalDays, s.sendHour, s.client.timezone, dbNow);
      await prisma().reportSchedule.updateMany({
        where: { id, nextRunAt: s.nextRunAt },
        data: {
          nextRunAt: next.runAt,
          ...(period ? { lastPeriodEnd: new Date(`${period.end}T00:00:00Z`) } : {}),
        },
      });
    } catch {
      skipped++; // leave nextRunAt as it is: the next tick tries again
    }
  }
  return { created, skipped };
}
