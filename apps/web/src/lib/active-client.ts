import "server-only";
import { cookies } from "next/headers";
import { listClients } from "@automation/db";
import type { SessionActor } from "./session";

export const ACTIVE_CLIENT_COOKIE = "active_client";
export const ALL_CLIENTS = "all";

export type ActiveClientState = {
  options: { id: string; name: string; status: string }[];
  /** The client the whole app is scoped to; undefined means all clients (admins only). */
  activeId: string | undefined;
};

/**
 * Resolve the client switcher state. The cookie is only a preference: it is
 * checked against the clients the actor can actually access on every request.
 */
export async function getActiveClient(actor: SessionActor): Promise<ActiveClientState> {
  const clients = await listClients(actor);
  const options = clients.map(({ id, name, status }) => ({ id, name, status }));
  const saved = (await cookies()).get(ACTIVE_CLIENT_COOKIE)?.value;

  if (saved && options.some((o) => o.id === saved)) return { options, activeId: saved };
  if (actor.isAdmin) return { options, activeId: undefined };
  // Members and viewers always work inside one of their clients.
  return { options, activeId: options[0]?.id };
}
