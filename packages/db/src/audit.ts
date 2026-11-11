import { logger } from "@automation/config";
import { getUnscopedPrisma } from "./unsafe";
import type { Prisma } from "./generated/client";

type Json = Prisma.InputJsonValue;

export type AuditEntry = {
  actorUserId: string | null;
  /** Optional: derived from the client when omitted. Required for agency-level events. */
  agencyId?: string | null;
  clientId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: Json | null;
  after?: Json | null;
};

/** Anything with auditLog.create: a scoped client or a transaction client. */
export type AuditWriter = {
  auditLog: { create(args: { data: Prisma.AuditLogUncheckedCreateInput }): PromiseLike<unknown> };
};

export async function recordAudit(db: AuditWriter, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actorUserId: entry.actorUserId,
      agencyId: entry.agencyId ?? null,
      clientId: entry.clientId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before ?? undefined,
      after: entry.after ?? undefined,
    },
  });
}

/** A security-relevant event outside a normal data transaction (login, denial, reset, ...). */
export type SecurityEvent = {
  action: string;
  actorUserId?: string | null;
  actorType?: "user" | "system" | "automation";
  agencyId?: string | null;
  clientId?: string | null;
  entityType: string;
  entityId: string;
  /** Never put secrets, tokens or passwords here. */
  details?: Json;
  ipAddress?: string | null;
  requestId?: string | null;
};

/**
 * Best-effort audit write for events that happen outside a data transaction (sign-in, denied
 * access, password reset). A failure is logged but never turns into a request failure, and the
 * original outcome (e.g. the denial) always stands.
 */
export async function recordSecurityEvent(event: SecurityEvent): Promise<void> {
  try {
    await getUnscopedPrisma().auditLog.create({
      data: {
        action: event.action,
        actorUserId: event.actorUserId ?? null,
        actorType: event.actorType ?? "user",
        agencyId: event.agencyId ?? null,
        clientId: event.clientId ?? null,
        entityType: event.entityType,
        entityId: event.entityId,
        after: event.details ?? undefined,
        ipAddress: event.ipAddress ?? null,
        requestId: event.requestId ?? null,
      },
    });
  } catch (error) {
    logger.error("audit: could not record security event", { action: event.action, error });
  }
}

/** Count recent events of one kind for one key (used for DB-backed throttling). */
export function countSecurityEvents(query: {
  action: string;
  entityId?: string;
  ipAddress?: string;
  since: Date;
}): Promise<number> {
  return getUnscopedPrisma().auditLog.count({
    where: {
      action: query.action,
      createdAt: { gte: query.since },
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.ipAddress ? { ipAddress: query.ipAddress } : {}),
    },
  });
}
