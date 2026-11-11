import { clientIdsWith, getAccessMap, type Actor } from "../access";
import { NotFoundError } from "../errors";
import { getUnscopedPrisma } from "../unsafe";
import { validateAll } from "./document";
import { collectMetrics, type MetricsResult, type Range } from "./metrics";

/**
 * Agency, client and project dashboards over real records. Which clients are included depends on what the person may
 * see (`analytics.view`); internal figures (AI usage and cost, overdue tasks) are included only for staff who can see
 * automation on every included client, so a client's own people never see them.
 */
export type DashboardLevel = "agency" | "client" | "project";
export type ClientRow = {
  clientId: string;
  name: string;
  clicks: number | null;
  sessions: number | null;
  tasksCompleted: number | null;
  overdue: number | null;
  openCritical: number;
  integrationProblems: number;
  stale: boolean;
};

export async function getDashboard(
  actor: Actor,
  f: { clientId?: string; projectId?: string; range: Range; includeMock?: boolean; now?: Date },
): Promise<{
  level: DashboardLevel;
  metrics: MetricsResult;
  clients: ClientRow[];
  scopeName: string;
  internal: boolean;
}> {
  const map = await getAccessMap(actor);
  const allowed = clientIdsWith(map, "analytics.view");
  const ids = f.clientId ? allowed.filter((c) => c === f.clientId) : allowed;
  if (f.clientId && ids.length === 0) throw new NotFoundError("Client not found");
  const prisma = getUnscopedPrisma();
  let projectName: string | null = null;
  if (f.projectId) {
    const p = f.clientId
      ? await prisma.project.findFirst({
          where: { id: f.projectId, clientId: f.clientId, archivedAt: null },
          select: { name: true },
        })
      : null;
    if (!p) throw new NotFoundError("Project not found");
    projectName = p.name;
  }
  const internal =
    ids.length > 0 && ids.every((c) => map.get(c)!.permissions.has("automation.view"));
  const level: DashboardLevel = f.projectId ? "project" : f.clientId ? "client" : "agency";
  const scope = {
    clientIds: ids,
    projectId: f.projectId ?? null,
    includeMock: f.includeMock,
    internal,
    now: f.now,
  };
  const metrics = validateAll(await collectMetrics(scope, f.range));
  let clients: ClientRow[] = [];
  if (level === "agency" && ids.length > 1) {
    const names = new Map(
      (
        await prisma.client.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      ).map((c) => [c.id, c.name]),
    );
    clients = await Promise.all(
      ids.map(async (id) => {
        const m = validateAll(await collectMetrics({ ...scope, clientIds: [id] }, f.range));
        return {
          clientId: id,
          name: names.get(id) ?? "Client",
          clicks: m.search.clicks.value,
          sessions: m.traffic.sessions.value,
          tasksCompleted: m.work.completed.value,
          overdue: internal ? m.work.overdue.value : null,
          openCritical: m.work.issuesOpen.critical,
          integrationProblems: m.integrations.filter((i) => i.status !== "active").length,
          stale: m.freshness.some((x) => x.stale && !x.mock),
        };
      }),
    );
    clients.sort((a, b) => a.name.localeCompare(b.name));
  }
  const scopeName =
    projectName ??
    (f.clientId
      ? ((await prisma.client.findUnique({ where: { id: f.clientId }, select: { name: true } }))
          ?.name ?? "Client")
      : "All clients");
  return { level, metrics, clients, scopeName, internal };
}
