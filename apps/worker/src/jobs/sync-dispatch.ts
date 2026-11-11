import {
  claimNextQueuedRun,
  failStaleRuns,
  finishRun,
  loadRunForExecution,
  loadGoogleSettings,
  loadSeRankingSettings,
  queueDueSyncs,
  updateAccountCredentials,
  type SecretCipher,
  type SyncExecution,
  type SyncResult,
} from "@automation/db";
import {
  PROVIDERS,
  ProviderError,
  RateLimiter,
  defaultRegistry,
  redact,
  runSync,
  toProviderError,
  type AdapterRegistry,
  type SyncSink,
} from "@automation/integrations";

import { createProviderSink } from "./provider-sink";

const isGoogle = (key: string) => key === "google_analytics_4" || key === "google_search_console";

/** What an adapter needs to know about the account: which projects or properties a person selected. */
async function settingsFor(execution: SyncExecution) {
  if (execution.providerKey === "se_ranking" && !execution.isMock)
    return loadSeRankingSettings(execution.accountId);
  if (isGoogle(execution.providerKey)) return loadGoogleSettings(execution.accountId);
  return undefined;
}

export const SYNC_QUEUE = "integration-sync";

/** A run still "running" after this long is assumed lost (worker crash) and failed. */
const STALE_RUN_MS = 30 * 60_000;
const MAX_RUNS_PER_TICK = 20;

/**
 * Provider-specific tables do not exist yet, so nothing is persisted and `rowsWritten` stays 0.
 * Counting rows as written would misreport what happened.
 */
export const discardSink: SyncSink = { write: async () => 0 };

const failure = (error: ProviderError, secrets: readonly string[]): SyncResult => ({
  status: "failed",
  rowsFetched: 0,
  rowsWritten: 0,
  needsReconnect: error.needsReconnect,
  errors: [
    { code: error.code, message: redact(error.safeMessage, secrets), retryable: error.retryable },
  ],
});

/** Execute one claimed run through the shared pipeline. Never throws: every outcome becomes a result. */
export async function executeRun(
  execution: SyncExecution,
  deps: {
    registry: AdapterRegistry;
    limiter: RateLimiter;
    sink?: SyncSink;
    /** Per-account settings handed to the adapter (e.g. the linked SE Ranking projects). */
    settings?: unknown;
    /** Stores rotated credentials. Must succeed before the new token is used. */
    persistCredentials?: (
      credentials: Record<string, string>,
      expiresAt: string | null,
    ) => Promise<void>;
  },
): Promise<SyncResult> {
  const secrets = Object.values(execution.credentials);
  const source = execution.isMock ? "mock" : "live";
  try {
    const adapter = deps.registry.get(execution.providerKey, execution.isMock ? "mock" : "live");
    const sink = deps.sink ?? discardSink;
    const outcome = await runSync({
      adapter,
      credentials: execution.credentials,
      ctx: {
        accountId: execution.accountId,
        clientId: execution.clientId,
        settings: deps.settings,
        onCredentialsRefreshed: deps.persistCredentials
          ? (fresh, meta) => deps.persistCredentials!(fresh, meta.expiresAt)
          : undefined,
      },
      sink,
      limiter: deps.limiter,
      since: execution.lastSyncedAt,
      // Mock accounts have no real permissions; live ones are limited to what was granted.
      grantedScopes: execution.isMock ? undefined : execution.scopes,
    });
    return {
      status: outcome.status,
      rowsFetched: outcome.rowsFetched,
      rowsWritten: outcome.rowsWritten,
      needsReconnect: outcome.needsReconnect,
      errors: outcome.errors.map((e) => ({ ...e, message: redact(e.message, secrets) })),
      summary: {
        source,
        unsupported: outcome.unsupported,
        written: "written" in sink ? (sink as { written: Record<string, number> }).written : {},
      },
    };
  } catch (error) {
    // No adapter for this provider yet, or a bug: say so without leaking anything.
    const message =
      error instanceof Error && error.message.startsWith("No live adapter")
        ? "A live connection for this provider is not available yet."
        : undefined;
    return failure(
      message ? new ProviderError("invalid_request", message) : toProviderError(error),
      secrets,
    );
  }
}

const limiters = new Map<string, RateLimiter>(
  PROVIDERS.map((p) => [p.key, new RateLimiter(p.rateLimit)]),
);

/** One scheduler tick: end stuck runs, queue what is due, then execute queued runs. */
export async function runSyncTick(cipher: SecretCipher) {
  const reaped = await failStaleRuns(STALE_RUN_MS);
  const intervalMinutes = Object.fromEntries(
    PROVIDERS.filter((p) => p.sync.mode !== "webhook" && defaultRegistry.hasLive(p.key)).map(
      (p) => [p.key, p.sync.defaultIntervalMinutes],
    ),
  );
  const queued = await queueDueSyncs({ intervalMinutes, maxAutoAttempts: 3, retryBaseMinutes: 5 });

  let executed = 0;
  for (; executed < MAX_RUNS_PER_TICK; executed++) {
    const runId = await claimNextQueuedRun();
    if (!runId) break;
    let result: SyncResult;
    try {
      const execution = await loadRunForExecution(runId, cipher);
      result = await executeRun(execution, {
        registry: defaultRegistry,
        limiter: limiters.get(execution.providerKey) ?? new RateLimiter({ perSecond: 1 }),
        // Google mocks produce realistic metrics through the real storage code (flagged as mock);
        // other mocks store nothing.
        sink:
          execution.isMock && !isGoogle(execution.providerKey)
            ? discardSink
            : createProviderSink(execution),
        settings: await settingsFor(execution),
        persistCredentials: (credentials, expiresAt) =>
          updateAccountCredentials(execution.accountId, credentials, cipher, {
            tokenExpiresAt: expiresAt ? new Date(expiresAt) : null,
          }),
      });
    } catch {
      result = failure(new ProviderError("unknown", "The sync could not be started."), []);
    }
    await finishRun(runId, result);
  }
  return { reaped, ...queued, executed };
}
