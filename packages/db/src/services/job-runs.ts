import { forClient, forSystem } from "../access";

/** Active clients, for generic scheduled jobs. System use (worker) only. */
export function listActiveClients() {
  return forSystem().client.findMany({
    where: { status: "active" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/**
 * Run `work` for one client and record the execution in job_runs.
 * Failures are recorded and rethrown so the queue can retry.
 */
export async function runLogged<T>(
  jobName: string,
  clientId: string,
  work: () => Promise<T>,
): Promise<T> {
  const db = forClient(clientId);
  const run = await db.jobRun.create({ data: { jobName, clientId } });
  try {
    const result = await work();
    await db.jobRun.update({
      where: { id: run.id },
      data: { status: "success", finishedAt: new Date() },
    });
    return result;
  } catch (error) {
    await db.jobRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        error: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000),
      },
    });
    throw error;
  }
}

export type ForEachResult = { succeeded: number; failed: number };

/**
 * The generic scheduled-job pattern: run `work` once for every active client,
 * each with its own job_runs row. One client failing never blocks the others.
 * Per-client behavior must come from that client's data, never from code.
 */
export async function forEachActiveClient(
  jobName: string,
  work: (client: { id: string; name: string }) => Promise<void>,
): Promise<ForEachResult> {
  const clients = await listActiveClients();
  const result: ForEachResult = { succeeded: 0, failed: 0 };
  for (const client of clients) {
    try {
      await runLogged(jobName, client.id, () => work(client));
      result.succeeded++;
    } catch {
      // Already recorded in job_runs by runLogged.
      result.failed++;
    }
  }
  return result;
}
