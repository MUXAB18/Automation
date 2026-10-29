"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";

export type LoginState = { error?: string };

const loginSchema = z.object({ email: z.email(), password: z.string().min(1) });

export async function signInAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter your email and password" };

  try {
    await auth.api.signInEmail({ body: parsed.data, headers: await headers() });
  } catch {
    // Same message for unknown email and wrong password.
    return { error: "Invalid email or password" };
  }
  redirect("/");
}

export async function signOutAction() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}
