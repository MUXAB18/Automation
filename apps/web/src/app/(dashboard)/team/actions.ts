"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ROLE_KEYS,
  ValidationError,
  inviteMember,
  removeAgencyMember,
  revokeInvitation,
  setAgencyMemberRoles,
} from "@automation/db";
import { getWebEnv } from "@/lib/env";
import { sendMail } from "@/lib/mailer";
import { requireActor } from "@/lib/session";

export type TeamState = { error?: string; success?: string; inviteUrl?: string };

const ids = z.object({ agencyId: z.string().min(1), userId: z.string().min(1) });

/** Turn a service error into a message for the form. Anything unexpected is rethrown (and logged). */
function toState(error: unknown): TeamState {
  if (error instanceof ValidationError)
    return { error: Object.values(error.fieldErrors).flat()[0] ?? "Check the form" };
  if (error instanceof ConflictError) return { error: error.message };
  if (error instanceof ForbiddenError)
    return { error: error.message || "You are not allowed to do that" };
  if (error instanceof NotFoundError) return { error: "Not found, or you do not have access" };
  throw error;
}

const roleKeys = (formData: FormData) =>
  z.array(z.enum(ROLE_KEYS)).parse(formData.getAll("roleKeys"));

export async function inviteAction(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const actor = await requireActor();
  const clientId = String(formData.get("clientId") ?? "");
  const email = String(formData.get("email") ?? "");
  try {
    const { token } = await inviteMember(actor, {
      agencyId: String(formData.get("agencyId") ?? ""),
      clientId: clientId || undefined,
      email,
      roleKeys: roleKeys(formData),
      allClientsAccess: formData.get("allClientsAccess") === "on",
    });
    const inviteUrl = `${getWebEnv().APP_URL}/invite/${token}`;
    let emailed = true;
    try {
      await sendMail({
        to: email,
        subject: "You're invited",
        text: `You've been invited to join the team.\n\nAccept the invitation (the link works once and expires in 7 days):\n${inviteUrl}`,
      });
    } catch (error) {
      emailed = false;
      console.error("invitation email failed", error instanceof Error ? error.message : error);
    }
    revalidatePath("/team");
    // The admin sees the link once, so they can pass it on if email is not configured.
    return {
      success: emailed
        ? `Invitation emailed to ${email.toLowerCase()}.`
        : "Invitation created, but the email could not be sent. Share the link below.",
      inviteUrl,
    };
  } catch (error) {
    if (error instanceof z.ZodError) return { error: "Choose at least one role" };
    return toState(error);
  }
}

export async function revokeInvitationAction(formData: FormData) {
  const actor = await requireActor();
  const parsed = z
    .object({ agencyId: z.string().min(1), invitationId: z.string().min(1) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  try {
    await revokeInvitation(actor, parsed.data.agencyId, parsed.data.invitationId);
  } catch (error) {
    toState(error);
  }
  revalidatePath("/team");
}

export async function setRolesAction(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const actor = await requireActor();
  const parsed = ids.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request" };
  try {
    await setAgencyMemberRoles(actor, {
      ...parsed.data,
      roleKeys: roleKeys(formData),
      allClientsAccess: formData.get("allClientsAccess") === "on",
    });
  } catch (error) {
    if (error instanceof z.ZodError) return { error: "Choose at least one role" };
    return toState(error);
  }
  revalidatePath("/team");
  return { success: "Saved" };
}

export async function removeMemberAction(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const actor = await requireActor();
  const parsed = ids.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request" };
  try {
    await removeAgencyMember(actor, parsed.data.agencyId, parsed.data.userId);
  } catch (error) {
    return toState(error);
  }
  revalidatePath("/team");
  return {};
}

type ConfirmResult = { error?: string; success?: string };

/** Shaped for ConfirmDialog: removing a person from the agency team. */
export async function removeMemberConfirmAction(formData: FormData): Promise<ConfirmResult> {
  const r = await removeMemberAction({}, formData);
  return r.error ? { error: r.error } : { success: "Removed from the team" };
}

export async function revokeInvitationConfirmAction(formData: FormData): Promise<ConfirmResult> {
  const actor = await requireActor();
  const parsed = z
    .object({ agencyId: z.string().min(1), invitationId: z.string().min(1) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request" };
  try {
    await revokeInvitation(actor, parsed.data.agencyId, parsed.data.invitationId);
  } catch (error) {
    return { error: toState(error).error };
  }
  revalidatePath("/team");
  return { success: "Invitation revoked" };
}
