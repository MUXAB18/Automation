"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";

export type ResetState = { error?: string };

const schema = z
  .object({
    token: z.string().min(1).max(256),
    password: z.string().min(12, "Use at least 12 characters").max(128),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    path: ["confirm"],
    message: "The passwords do not match",
  });

export async function resetPasswordAction(
  _prev: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  try {
    await auth.api.resetPassword({
      body: { newPassword: parsed.data.password, token: parsed.data.token },
    });
  } catch {
    return { error: "This reset link is invalid or has expired. Request a new one." };
  }
  redirect("/login?reset=1");
}
