import { Queue, Worker } from "bullmq";
import { loadEnv, workerEnvSchema } from "@automation/config";
import { HEARTBEAT_QUEUE, runHeartbeat } from "./jobs/heartbeat";
import { redisConnection } from "./redis";

const env = loadEnv(workerEnvSchema);
const connection = redisConnection(env.REDIS_URL);

const queue = new Queue(HEARTBEAT_QUEUE, { connection });

// Idempotent: re-registering on every start keeps one repeating schedule.
await queue.upsertJobScheduler(
  HEARTBEAT_QUEUE,
  { every: env.HEARTBEAT_INTERVAL_MS },
  { name: HEARTBEAT_QUEUE },
);

const worker = new Worker(
  HEARTBEAT_QUEUE,
  async () => {
    const result = await runHeartbeat();
    console.log(`heartbeat: ${result.succeeded} ok, ${result.failed} failed`);
    return result;
  },
  { connection },
);

worker.on("failed", (job, error) => console.error(`job ${job?.id} failed:`, error.message));
worker.on("error", (error) => console.error("worker error:", error.message));

console.log(`worker started (heartbeat every ${env.HEARTBEAT_INTERVAL_MS} ms)`);

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  await worker.close();
  await queue.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
