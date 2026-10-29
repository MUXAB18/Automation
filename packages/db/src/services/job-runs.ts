import { forCustomer, forSystem } from "../access";

/** Active customers, for generic scheduled jobs. System use (worker) only. */
export function listActiveCustomers() {
  return forSystem().customer.findMany({
    where: { status: "active" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/**
 * Run `work` for one customer and record the execution in job_runs.
 * Failures are recorded and rethrown so the queue can retry.
 */
export async function runLogged<T>(
  jobName: string,
  customerId: string,
  work: () => Promise<T>,
): Promise<T> {
  const db = forCustomer(customerId);
  const run = await db.jobRun.create({ data: { jobName, customerId } });
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
 * The generic scheduled-job pattern: run `work` once for every active customer,
 * each with its own job_runs row. One customer failing never blocks the others.
 * Per-customer behavior must come from that customer's data, never from code.
 */
export async function forEachActiveCustomer(
  jobName: string,
  work: (customer: { id: string; name: string }) => Promise<void>,
): Promise<ForEachResult> {
  const customers = await listActiveCustomers();
  const result: ForEachResult = { succeeded: 0, failed: 0 };
  for (const customer of customers) {
    try {
      await runLogged(jobName, customer.id, () => work(customer));
      result.succeeded++;
    } catch {
      // Already recorded in job_runs by runLogged.
      result.failed++;
    }
  }
  return result;
}
