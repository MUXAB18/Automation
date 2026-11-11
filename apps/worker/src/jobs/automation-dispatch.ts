import {
  claimNextAutomationRun,
  executeAutomationRun,
  failStaleAutomationRuns,
  queueDueAutomationRuns,
} from "@automation/db";

export const AUTOMATION_QUEUE = "automation-engine";
const MAX_RUNS_PER_TICK = 25;

/**
 * One tick of the monitoring engine: end stuck runs, queue due rules (and retries), then execute queued
 * runs one at a time. All idempotency lives in the database layer, so overlapping or repeated ticks are safe.
 */
export async function runAutomationTick() {
  const reaped = await failStaleAutomationRuns();
  const queued = await queueDueAutomationRuns();
  let executed = 0;
  for (; executed < MAX_RUNS_PER_TICK; executed++) {
    const runId = await claimNextAutomationRun();
    if (!runId) break;
    await executeAutomationRun(runId); // never throws: failures are recorded on the run
  }
  return { reaped, ...queued, executed };
}
