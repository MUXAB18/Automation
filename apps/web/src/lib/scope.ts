import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { listClients, listProjectOptions } from "@automation/db";
import type { SessionActor } from "./session";

export const ACTIVE_CLIENT_COOKIE = "active_client";
export const ACTIVE_PROJECT_COOKIE = "active_project";
export const ALL = "all";

export type Scope = {
  clients: { id: string; name: string; status: string }[];
  /** Selected client, or undefined for "all my clients". */
  clientId: string | undefined;
  projects: { id: string; name: string; isSample: boolean }[];
  /** Selected project (only when a client is selected). */
  projectId: string | undefined;
};

/**
 * The client/project the user has chosen in the header. The cookies are only preferences: both are
 * validated against what the user may actually access on every request, so a tampered cookie
 * silently falls back to "all".
 */
export const getScope = cache(async (actor: SessionActor): Promise<Scope> => {
  const jar = await cookies();
  const clients = (await listClients(actor)).map(({ id, name, status }) => ({ id, name, status }));
  const savedClient = jar.get(ACTIVE_CLIENT_COOKIE)?.value;
  const clientId =
    savedClient && clients.some((c) => c.id === savedClient) ? savedClient : undefined;

  const projects = await listProjectOptions(actor, clientId);
  const savedProject = jar.get(ACTIVE_PROJECT_COOKIE)?.value;
  const projectId =
    savedProject && projects.some((p) => p.id === savedProject) ? savedProject : undefined;
  return { clients, clientId, projects, projectId };
});
