import { getClientContext, requireAgencyPermission, type ClientContext } from "./access";
import type { Actor } from "./access";
import { recordSecurityEvent } from "./audit";
import { ForbiddenError, NotFoundError } from "./errors";
import { can, isClientRoleOnly, type Access, type Permission } from "./permissions";
import { getUnscopedPrisma } from "./unsafe";

/**
 * Ids supplied by a request (URL, form field, API body). They are untrusted: `authorize` checks
 * that they are consistent with each other and that the actor may use them.
 */
export type AuthzTarget = { agencyId?: string; clientId?: string; projectId?: string };

export type AuthzContext =
  | ({ level: "client"; projectId?: string } & ClientContext)
  | { level: "agency"; agencyId: string; access: Access };

/**
 * The single entry point for "may this user do X to this thing?". It resolves the most specific id
 * given, cross-checks the others against it (a project id that belongs to a different client than the
 * clientId supplied is rejected), verifies the actor's roles, and for project-scoped users verifies
 * project membership. Failures are NotFoundError (no access / inconsistent ids) or ForbiddenError
 * (has access but lacks the permission), and are written to the audit log.
 */
export async function authorize(
  actor: Actor,
  target: AuthzTarget,
  permission: Permission,
): Promise<AuthzContext> {
  const prisma = getUnscopedPrisma();
  let { clientId } = target;

  if (target.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: target.projectId },
      select: { clientId: true },
    });
    if (!project || (clientId && project.clientId !== clientId)) {
      await refuse(actor, target, "project_mismatch");
      throw new NotFoundError("Project not found");
    }
    clientId = project.clientId;
  }

  if (clientId) {
    const ctx = await getClientContext(actor, clientId);
    if (target.agencyId && ctx.agencyId !== target.agencyId) {
      await refuse(actor, target, "agency_mismatch");
      throw new NotFoundError("Client not found");
    }
    if (!can(ctx.access, permission)) {
      await recordSecurityEvent({
        action: "authz.permission_denied",
        actorUserId: actor.userId,
        agencyId: ctx.agencyId,
        clientId,
        entityType: "client",
        entityId: clientId,
        details: { permission },
      });
      throw new ForbiddenError();
    }
    if (target.projectId && isClientRoleOnly(ctx.access)) {
      const member = await prisma.projectMembership.findUnique({
        where: { projectId_userId: { projectId: target.projectId, userId: actor.userId } },
        select: { id: true },
      });
      if (!member) {
        await refuse(actor, target, "project_membership_required");
        throw new NotFoundError("Project not found");
      }
    }
    return { level: "client", projectId: target.projectId, ...ctx };
  }

  if (target.agencyId) {
    const access = await requireAgencyPermission(actor, target.agencyId, permission);
    return { level: "agency", agencyId: target.agencyId, access };
  }
  throw new NotFoundError("Nothing to authorize");
}

async function refuse(actor: Actor, target: AuthzTarget, reason: string) {
  await recordSecurityEvent({
    action: "authz.access_denied",
    actorUserId: actor.userId,
    entityType: target.projectId ? "project" : target.clientId ? "client" : "agency",
    entityId: target.projectId ?? target.clientId ?? target.agencyId ?? "unknown",
    details: { reason, ...target },
  });
}
