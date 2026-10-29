"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { recordSecurityEvent } from "@automation/db";
import { auth } from "@/lib/auth";
import { getRequestIp } from "@/lib/request-info";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { getSession } from "@/lib/session";
import { LOGIN_FAILURE, isThrottled, recordAttempt } from "@/lib/throttle";

export type LoginState = { error?: string };

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(128),
  next: z.string().optional(),
});

export async function signInAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter your email and password" };
  const { email, password } = parsed.data;
  const ip = await getRequestIp();

  if (await isThrottled(LOGIN_FAILURE, email, ip)) {
    return { error: "Too many attempts. Wait 15 minutes, or reset your password." };
  }

  try {
    await auth.api.signInEmail({ body: { email, password }, headers: await headers() });
  } catch {
    await recordAttempt(LOGIN_FAILURE.action, email, ip);
    // Same message for unknown email, wrong password and deactivated accounts.
    return { error: "Invalid email or password" };
  }
  redirect(safeRedirectPath(parsed.data.next));
}

export async function signOutAction() {
  const session = await getSession();
  if (session) {
    await recordSecurityEvent({
      action: "auth.logout",
      actorUserId: session.user.id,
      entityType: "user",
      entityId: session.user.id,
      ipAddress: await getRequestIp(),
    });
  }
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}
