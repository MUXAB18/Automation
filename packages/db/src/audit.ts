import type { Prisma } from "./generated/client";

type Json = Prisma.InputJsonValue;

export type AuditEntry = {
  actorUserId: string | null;
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
      clientId: entry.clientId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before ?? undefined,
      after: entry.after ?? undefined,
    },
  });
}
