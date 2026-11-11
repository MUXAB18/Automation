import { createServer, type Server } from "node:http";

export type LoopState = { name: string; everyMs: number; lastTickAt: number | null };

export type HealthReport = {
  status: "ok" | "degraded" | "error";
  checks: { database: boolean; redis: boolean };
  loops: Array<{ name: string; ageSeconds: number | null; stale: boolean }>;
};

/** A loop is stale when it has not completed a tick for this many intervals (and at least a minute). */
const STALE_AFTER_INTERVALS = 5;
const MIN_STALE_MS = 60_000;

/**
 * Pure: turns dependency checks and loop timestamps into a status. A loop that has never ticked gets
 * `startupGraceMs` (so a fresh start is not reported as broken). Dependencies down = error (the worker
 * cannot do its job); only stale loops = degraded (a stuck queue worker the container should restart).
 */
export function buildHealth(
  checks: { database: boolean; redis: boolean },
  loops: LoopState[],
  now: number,
  startedAt: number,
  startupGraceMs = 120_000,
): HealthReport {
  const rows = loops.map((loop) => {
    const limit = Math.max(loop.everyMs * STALE_AFTER_INTERVALS, MIN_STALE_MS);
    const since = loop.lastTickAt ?? startedAt;
    const age = now - since;
    const stale = loop.lastTickAt === null ? age > startupGraceMs + limit : age > limit;
    return {
      name: loop.name,
      ageSeconds: loop.lastTickAt === null ? null : Math.round(age / 1000),
      stale,
    };
  });
  const status =
    !checks.database || !checks.redis ? "error" : rows.some((r) => r.stale) ? "degraded" : "ok";
  return { status, checks, loops: rows };
}

/**
 * Minimal HTTP health endpoint for Docker/Kubernetes probes. Returns 200 only when the worker can reach
 * Postgres and Redis and its polling loops are alive; the body names no hosts, URLs or errors.
 */
export function startHealthServer(port: number, report: () => Promise<HealthReport>): Server {
  const server = createServer((req, res) => {
    if (req.method !== "GET" || (req.url !== "/health" && req.url !== "/")) {
      res.writeHead(404).end();
      return;
    }
    report().then(
      (body) => {
        res
          .writeHead(body.status === "ok" ? 200 : 503, { "content-type": "application/json" })
          .end(JSON.stringify(body));
      },
      () => res.writeHead(503, { "content-type": "application/json" }).end('{"status":"error"}'),
    );
  });
  server.listen(port, "0.0.0.0");
  return server;
}
