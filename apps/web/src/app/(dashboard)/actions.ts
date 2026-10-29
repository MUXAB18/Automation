"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { listClients, listProjectOptions, markNotificationsRead } from "@automation/db";
import { ACTIVE_CLIENT_COOKIE, ACTIVE_PROJECT_COOKIE } from "@/lib/scope";
import { requireActor } from "@/lib/session";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";

const cookieOptions = {
  path: "/",
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 365,
} as const;

/**
 * Remember the client/project chosen in the header. Only values the actor may actually use are
 * stored; anything else (a guessed or stale id) clears the choice.
 */
export async function setScopeAction(formData: FormData) {
  const actor = await requireActor();
  const jar = await cookies();
  const clientValue = formData.get("clientId");
  const projectValue = formData.get("projectId");
  const clear = { ...cookieOptions, maxAge: 0 };

  const clients = await listClients(actor);
  const clientId =
    typeof clientValue === "string" && clients.some((c) => c.id === clientValue)
      ? clientValue
      : undefined;
  if (!clientId) {
    jar.set(ACTIVE_CLIENT_COOKIE, "", clear);
    jar.set(ACTIVE_PROJECT_COOKIE, "", clear);
  } else {
    jar.set(ACTIVE_CLIENT_COOKIE, clientId, cookieOptions);
    // The project must belong to the client being selected now (not the one in an old cookie).
    const projects = await listProjectOptions(actor, clientId);
    const projectId =
      typeof projectValue === "string"
        ? projects.find((p) => p.id === projectValue)?.id
        : undefined;
    if (projectId) jar.set(ACTIVE_PROJECT_COOKIE, projectId, cookieOptions);
    else jar.set(ACTIVE_PROJECT_COOKIE, "", clear);
  }
  revalidatePath("/", "layout");
}

/** Light, dark or follow the operating system. A preference only; no security implications. */
export async function setThemeAction(formData: FormData) {
  await requireActor();
  (await cookies()).set(THEME_COOKIE, parseTheme(formData.get("theme")), {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}

export async function markNotificationsReadAction() {
  const actor = await requireActor();
  await markNotificationsRead(actor);
  revalidatePath("/", "layout");
}
