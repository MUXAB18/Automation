"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getRequestIp } from "@/lib/request-info";
import { RESET_REQUEST, isThrottled, recordAttempt } from "@/lib/throttle";

export type ForgotState = { error?: string; sent?: boolean };

const schema = z.object({ email: z.email() });

/** Always answers the same way, whether or not the email has an account. */
export async function requestPasswordResetAction(
  _prev: ForgotState,
  formData: FormData,
): Promise<ForgotState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter a valid email address" };
  const { email } = parsed.data;
  const ip = await getRequestIp();

  // Every request counts, known email or not, so the limit itself reveals nothing.
  const throttled = await isThrottled(RESET_REQUEST, email, ip);
  await recordAttempt(RESET_REQUEST.action, email, ip);
  if (!throttled) {
    try {
      await auth.api.requestPasswordReset({
        body: { email, redirectTo: "/reset-password" },
        headers: await headers(),
      });
    } catch (error) {
      console.error(
        "password reset request failed",
        error instanceof Error ? error.message : error,
      );
    }
  }
  return { sent: true };
}
