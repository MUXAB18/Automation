/** Pure health derivation from recent sync runs, so the rules are easy to test and to explain on screen. */

export type HealthRun = {
  status: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  errorCodes: string[];
};

export type HealthState =
  "disconnected" | "needs_reconnect" | "not_synced" | "healthy" | "degraded" | "failing";

export type ProviderHealth = {
  state: HealthState;
  reason: string;
  runsConsidered: number;
  successRate: number | null;
  consecutiveFailures: number;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  avgDurationMs: number | null;
  rateLimitHits24h: number;
};

const FINISHED = new Set(["succeeded", "partial", "failed"]);

/** `runs` newest first. Queued, running and cancelled runs say nothing about health and are ignored. */
export function deriveHealth(
  account: { status: string },
  runs: readonly HealthRun[],
  now: Date = new Date(),
): ProviderHealth {
  const finished = runs.filter((r) => FINISHED.has(r.status));
  const ok = (r: HealthRun) => r.status === "succeeded" || r.status === "partial";
  let consecutiveFailures = 0;
  for (const r of finished) {
    if (r.status === "failed") consecutiveFailures++;
    else break;
  }
  const durations = finished
    .filter((r) => r.startedAt && r.finishedAt)
    .map((r) => r.finishedAt!.getTime() - r.startedAt!.getTime());
  const dayAgo = now.getTime() - 24 * 3600 * 1000;
  const base = {
    runsConsidered: finished.length,
    successRate: finished.length ? finished.filter(ok).length / finished.length : null,
    consecutiveFailures,
    lastSuccessAt: finished.find(ok)?.finishedAt ?? null,
    lastFailureAt: finished.find((r) => r.status === "failed")?.finishedAt ?? null,
    avgDurationMs: durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null,
    rateLimitHits24h: finished
      .filter((r) => r.createdAt.getTime() >= dayAgo)
      .reduce(
        (n, r) =>
          n + r.errorCodes.filter((c) => c === "rate_limited" || c === "quota_exhausted").length,
        0,
      ),
  };
  const result = (state: HealthState, reason: string): ProviderHealth => ({
    state,
    reason,
    ...base,
  });

  if (account.status === "disconnected")
    return result("disconnected", "This account was disconnected.");
  if (account.status === "needs_reauth")
    return result(
      "needs_reconnect",
      "The provider rejected the credentials. Reconnect the account.",
    );
  if (finished.length === 0) return result("not_synced", "No sync has finished yet.");
  if (consecutiveFailures >= 3)
    return result("failing", `The last ${consecutiveFailures} syncs failed in a row.`);
  if (consecutiveFailures >= 1 || finished[0]?.status === "partial")
    return result(
      "degraded",
      finished[0]?.status === "partial"
        ? "The last sync only partly worked."
        : "The last sync failed, earlier ones worked.",
    );
  return result("healthy", "Recent syncs succeeded.");
}
