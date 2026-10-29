import type { ConnectionOptions } from "bullmq";

/** Convert REDIS_URL into BullMQ connection options (BullMQ requires maxRetriesPerRequest: null for workers). */
export function redisConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  const db = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined;
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number.isInteger(db) ? db : undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}
