import { forEachActiveClient } from "@automation/db";

export const HEARTBEAT_QUEUE = "heartbeat";

/**
 * Proves the generic job pattern: loops over every active client and logs a
 * job_runs row for each. Real jobs (rank-check, site-audit, ...) copy this shape.
 */
export async function runHeartbeat() {
  return forEachActiveClient(HEARTBEAT_QUEUE, async () => {
    // Nothing to do per client; the job_runs row is the heartbeat.
  });
}
