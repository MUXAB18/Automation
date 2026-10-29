"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import {
  ConflictError,
  NotFoundError,
  ForbiddenError,
  ValidationError,
  acceptInvitation,
  acceptInvitationWithNewAccount,
} from "@automation/db";
import { auth } from "@/lib/auth";
import { requireActor } from "@/lib/session";

export type InviteState = { error?: string; needsSignIn?: boolean };

const GONE = "This invitation is invalid or has expired. Ask for a new one.";

const newAccountSchema = z
  .object({
    token: z.string().min(1).max(256),
    name: z.string().trim().min(1, "Enter your name").max(120),
    password: z.string().min(12, "Use at least 12 characters").max(128),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    path: ["confirm"],
    message: "The passwords do not match",
  });

/** A new person sets a name and password; the email address is fixed by the invitation. */
export async function createAccountFromInvitationAction(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const parsed = newAccountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  let email: string;
  try {
    const result = await acceptInvitationWithNewAccount({
      token: parsed.data.token,
      name: parsed.data.name,
      passwordHash: await hashPassword(parsed.data.password),
    });
    email = result.email;
  } catch (error) {
    if (error instanceof ConflictError)
      return { error: "You already have an account with this email.", needsSignIn: true };
    if (error instanceof NotFoundError) return { error: GONE };
    if (error instanceof ValidationError)
      return { error: Object.values(error.fieldErrors).flat()[0] ?? "Check the form" };
    throw error;
  }
  await auth.api.signInEmail({
    body: { email, password: parsed.data.password },
    headers: await headers(),
  });
  redirect("/");
}

/** A signed-in user accepts an invitation sent to their own email. */
export async function acceptInvitationAction(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const actor = await requireActor();
  const token = z.string().min(1).max(256).safeParse(formData.get("token"));
  if (!token.success) return { error: GONE };
  try {
    await acceptInvitation(actor.userId, token.data);
  } catch (error) {
    if (error instanceof NotFoundError) return { error: GONE };
    if (error instanceof ForbiddenError)
      return { error: "This invitation was sent to a different email address." };
    throw error;
  }
  redirect("/");
}
