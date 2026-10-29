"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ACTIVE_CLIENT_COOKIE, ALL_CLIENTS, getActiveClient } from "@/lib/active-client";
import { requireActor } from "@/lib/session";

export async function setActiveClientAction(formData: FormData) {
  const actor = await requireActor();
  const value = formData.get("clientId");
  const { options } = await getActiveClient(actor);

  // Only accept values the actor may actually use.
  const allowed =
    typeof value === "string" &&
    (options.some((o) => o.id === value) || (actor.isAdmin && value === ALL_CLIENTS));
  if (!allowed) return;

  (await cookies()).set(ACTIVE_CLIENT_COOKIE, value, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}
