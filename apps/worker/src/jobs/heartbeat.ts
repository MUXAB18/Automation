import { forEachActiveCustomer } from "@automation/db";

export const HEARTBEAT_QUEUE = "heartbeat";

/**
 * Proves the generic job pattern: loops over every active customer and logs a
 * job_runs row for each. Real jobs (rank-check, site-audit, ...) copy this shape.
 */
export async function runHeartbeat() {
  return forEachActiveCustomer(HEARTBEAT_QUEUE, async () => {
    // Nothing to do per customer; the job_runs row is the heartbeat.
  });
}
