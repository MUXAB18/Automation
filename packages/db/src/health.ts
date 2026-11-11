import { getUnscopedPrisma } from "./unsafe";

export type DatabaseHealth = { ok: true; latencyMs: number } | { ok: false };

/** Cheap round trip used by the web and worker health checks. Never throws and never exposes the error. */
export async function pingDatabase(timeoutMs = 3_000): Promise<DatabaseHealth> {
  const started = Date.now();
  try {
    await Promise.race([
      getUnscopedPrisma().$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs).unref()),
    ]);
    return { ok: true, latencyMs: Date.now() - started };
  } catch {
    return { ok: false };
  }
}
