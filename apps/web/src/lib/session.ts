import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Actor } from "@automation/db";
import { auth } from "./auth";

export type SessionActor = Actor & { name: string; email: string };

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

/** The signed-in user, or a redirect to /login. Call this in every page and server action. */
export async function requireActor(): Promise<SessionActor> {
  const session = await getSession();
  if (!session) redirect("/login");
  return {
    userId: session.user.id,
    isAdmin: session.user.isAdmin === true,
    name: session.user.name,
    email: session.user.email,
  };
}
