import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { loadEnv, logger as rootLogger, workerEnvSchema } from "@automation/config";
import { pingDatabase } from "@automation/db";
import {
  createTokenCipher,
  defaultRegistry,
  ghlConfigFromEnv,
  googleOAuthFromEnv,
  registerGoHighLevel,
  registerGoogle,
  registerSeRanking,
} from "@automation/integrations";
import { buildHealth, startHealthServer, type LoopState } from "./health";
import { HEARTBEAT_QUEUE, runHeartbeat } from "./jobs/heartbeat";
import { AI_QUEUE, runAiTick } from "./jobs/ai-dispatch";
import { REPORT_QUEUE, runReportTick } from "./jobs/report-dispatch";
import { AUTOMATION_QUEUE, runAutomationTick } from "./jobs/automation-dispatch";
import { PUBLISH_QUEUE, runPublishTick } from "./jobs/publish-dispatch";
import { SYNC_QUEUE, runSyncTick } from "./jobs/sync-dispatch";
import { redisConnection } from "./redis";

const log = rootLogger.child({ service: "worker" });
const startedAt = Date.now();

// A crash must be loud and structured, then let the container restart policy bring the worker back.
// Jobs are recoverable: runs left "running" are reaped on the next start (see job-runs / dispatchers).
process.on("unhandledRejection", (reason) => {
  log.error("unhandled rejection", { error: reason });
  process.exit(1);
});
process.on("uncaughtException", (error) => {
  log.error("uncaught exception", { error });
  process.exit(1);
});

const env = loadEnv(workerEnvSchema);
const connection = redisConnection(env.REDIS_URL);

const cipher = createTokenCipher(env.ENCRYPTION_KEY, env.ENCRYPTION_KEY_PREVIOUS);
const ghlLive = registerGoHighLevel(defaultRegistry, ghlConfigFromEnv(env));
registerSeRanking(defaultRegistry);
registerGoogle(defaultRegistry, googleOAuthFromEnv(env));

const queues: Queue[] = [];
const workers: Worker[] = [];
const loops: LoopState[] = [];

/**
 * One repeating loop: a BullMQ scheduler that fires a tick every `everyMs`, processed one at a time
 * (concurrency 1) so a slow provider cannot pile up overlapping ticks. `run` returns a plain object of
 * counters; it is logged only when something happened.
 */
async function startLoop<R extends object>(
  queueName: string,
  everyMs: number,
  run: () => Promise<R>,
  didWork: (result: R) => boolean,
) {
  const loopLog = log.child({ queue: queueName });
  const state: LoopState = { name: queueName, everyMs, lastTickAt: null };
  loops.push(state);
  const queue = new Queue(queueName, { connection });
  queues.push(queue);
  // Idempotent: re-registering on every start keeps one repeating schedule.
  await queue.upsertJobScheduler(queueName, { every: everyMs }, { name: queueName });
  const worker = new Worker(
    queueName,
    async () => {
      const result = await run();
      state.lastTickAt = Date.now();
      if (didWork(result)) loopLog.info("tick did work", { result });
      return result;
    },
    { connection, concurrency: 1 },
  );
  worker.on("failed", (job, error) => loopLog.error("job failed", { jobId: job?.id, error }));
  worker.on("error", (error) => loopLog.error("worker error", { error }));
  workers.push(worker);
}

const total = (r: Record<string, number>, keys: string[]) =>
  keys.reduce((sum, key) => sum + (r[key] ?? 0), 0);

await startLoop(
  HEARTBEAT_QUEUE,
  env.HEARTBEAT_INTERVAL_MS,
  () => runHeartbeat(),
  () => true,
);
await startLoop(
  REPORT_QUEUE,
  env.REPORT_POLL_INTERVAL_MS,
  () => runReportTick(env),
  (r) => total(r, ["reaped", "scheduled", "generated", "sent"]) > 0,
);
await startLoop(
  AI_QUEUE,
  5_000,
  () => runAiTick(env),
  (r) => total(r, ["executed", "reaped"]) > 0,
);
await startLoop(
  AUTOMATION_QUEUE,
  env.AUTOMATION_POLL_INTERVAL_MS,
  () => runAutomationTick(),
  (r) => total(r, ["executed", "queued", "retried", "reaped"]) > 0,
);
await startLoop(
  PUBLISH_QUEUE,
  env.SYNC_POLL_INTERVAL_MS,
  () => runPublishTick(cipher, env.GHL_PUBLISHING_ENABLED === "1"),
  (r) => total(r, ["executed", "reaped"]) > 0,
);
await startLoop(
  SYNC_QUEUE,
  env.SYNC_POLL_INTERVAL_MS,
  () => runSyncTick(cipher),
  (r) => total(r, ["executed", "scheduled", "retried", "reaped"]) > 0,
);

// Separate connection for the probe so a slow health check never queues behind job traffic.
const healthRedis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  commandTimeout: 2_000,
});
healthRedis.on("error", () => {});

const healthServer =
  env.WORKER_HEALTH_PORT > 0
    ? startHealthServer(env.WORKER_HEALTH_PORT, async () => {
        const [db, redis] = await Promise.all([
          pingDatabase(),
          (async () => {
            try {
              return (await healthRedis.ping()) === "PONG";
            } catch {
              return false;
            }
          })(),
        ]);
        return buildHealth({ database: db.ok, redis }, loops, Date.now(), startedAt);
      })
    : null;

log.info("worker started", {
  heartbeatEveryMs: env.HEARTBEAT_INTERVAL_MS,
  ghlLiveAdapter: ghlLive,
  healthPort: env.WORKER_HEALTH_PORT || null,
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("shutting down", { signal });
  // Never hang the container stop: in-flight jobs are recovered by the dispatchers' reapers on restart.
  const force = setTimeout(() => {
    log.warn("shutdown timed out, exiting");
    process.exit(1);
  }, 25_000);
  force.unref();
  try {
    healthServer?.close();
    await Promise.all(workers.map((w) => w.close()));
    await Promise.all(queues.map((q) => q.close()));
    healthRedis.disconnect();
  } catch (error) {
    log.error("error during shutdown", { error });
  }
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
