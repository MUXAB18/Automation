import { clientIdsWith, forClients, getAccessMap, type Actor } from "../access";
import { getUnscopedPrisma } from "../unsafe";

/**
 * Client portal helpers. The portal is not a separate data path: it calls the same authorised services as the
 * agency screens, so a client's people see exactly what their roles allow on their own client and nothing else.
 */

/** True when every client the person can reach, they reach only as a client (no agency staff role anywhere). */
export async function isClientOnlyUser(actor: Actor): Promise<boolean> {
  if (actor.isAdmin) return false;
  const map = await getAccessMap(actor);
  if (map.size === 0) return false;
  return [...map.values()].every(
    (a) => a.roles.size > 0 && [...a.roles].every((r) => r === "client"),
  );
}

/** Content waiting for THIS person's approval: client-approval stage, on clients where they hold the client role. */
export async function listAwaitingClientApproval(actor: Actor) {
  const map = await getAccessMap(actor);
  const ids = clientIdsWith(map, "content.approve").filter((c) => map.get(c)!.roles.has("client"));
  if (ids.length === 0) return [];
  const mine = await getUnscopedPrisma().clientMembership.findMany({
    where: {
      clientId: { in: ids },
      userId: actor.userId,
      status: "active",
      roles: { some: { role: { key: "client" } } },
    },
    select: { clientId: true },
  });
  const allowed = mine.map((m) => m.clientId);
  if (allowed.length === 0) return [];
  return forClients(allowed).contentItem.findMany({
    where: { status: "client_approval", archivedAt: null },
    orderBy: { updatedAt: "asc" },
    take: 50,
    select: {
      id: true,
      clientId: true,
      title: true,
      channel: true,
      scheduledFor: true,
      client: { select: { name: true, timezone: true } },
    },
  });
}
