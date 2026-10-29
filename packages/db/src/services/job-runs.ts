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
