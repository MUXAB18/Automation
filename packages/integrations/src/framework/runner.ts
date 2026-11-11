import { ProviderError, toProviderError } from "./errors";
import { systemClock, type Clock, type RateLimiter } from "./rate-limiter";
import { resolveResources } from "./resources";
import { withRetry } from "./retry";
import type {
  AdapterContext,
  Credentials,
  ProviderAdapter,
  SafeSyncError,
  SyncSink,
  UnsupportedResource,
} from "./types";

export type SyncOutcome = {
  status: "succeeded" | "partial" | "failed";
  rowsFetched: number;
  rowsWritten: number;
  errors: SafeSyncError[];
  /** Resources skipped because the account lacks the permission (or the provider lacks the endpoint). */
  unsupported: UnsupportedResource[];
  /** A person must reconnect the account (revoked token, missing scope). */
  needsReconnect: boolean;
  /** Seconds-level hint for when a rate-limited sync may run again. */
  retryAfterMs: number | null;
  source: "live" | "mock";
};

export type RunSyncOptions = {
  adapter: ProviderAdapter;
  credentials: Credentials;
  ctx: AdapterContext;
  sink: SyncSink;
  limiter: RateLimiter;
  resources?: readonly string[];
  /** Scopes the account was granted; decides which resources are supported. Omit = all supported. */
  grantedScopes?: readonly string[];
  since?: Date | null;
  /** Safety valve against a provider that never ends its cursor chain. */
  maxPagesPerResource?: number;
  maxAttempts?: number;
  clock?: Clock;
};

/**
 * Pull every page of every resource through the shared pipeline:
 * rate limit -> fetch (with retry) -> normalize -> persist.
 * Provider failures never throw out of here; they come back as safe errors on the outcome, so the
 * caller can always record the attempt. An auth failure stops the run; other failures skip that
 * resource and the run ends `partial` if anything else succeeded.
 */
export async function runSync(options: RunSyncOptions): Promise<SyncOutcome> {
  const { adapter, ctx, sink, limiter } = options;
  // Mutable: an OAuth refresh replaces the credentials for every later call in this run.
  let credentials = options.credentials;
  const refreshCtx: AdapterContext = {
    ...ctx,
    onCredentialsRefreshed: async (fresh, meta) => {
      await ctx.onCredentialsRefreshed?.(fresh, meta);
      credentials = fresh;
    },
  };
  const requested = options.resources ?? adapter.descriptor.resources;
  const { supported: resources, unsupported } = options.grantedScopes
    ? resolveResources(adapter.descriptor, options.grantedScopes, requested)
    : { supported: requested, unsupported: [] as UnsupportedResource[] };
  const clock = options.clock ?? systemClock;
  const limiterKey = `${adapter.descriptor.key}:${ctx.accountId}`;
  const maxPages = options.maxPagesPerResource ?? 1000;
  const outcome: SyncOutcome = {
    status: "succeeded",
    rowsFetched: 0,
    rowsWritten: 0,
    errors: [],
    unsupported,
    needsReconnect: false,
    retryAfterMs: null,
    source: adapter.isMock ? "mock" : "live",
  };
  let resourcesOk = 0;

  outer: for (const resource of resources) {
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    try {
      for (let pageNo = 0; pageNo < maxPages; pageNo++) {
        const page = await withRetry(
          async () => {
            await limiter.acquire(limiterKey);
            try {
              return await adapter.fetchPage(
                credentials,
                { resource, cursor, since: options.since ?? null },
                refreshCtx,
              );
            } catch (error) {
              const mapped = adapter.mapError(error);
              if (mapped.code === "rate_limited" && mapped.retryAfterMs)
                limiter.penalize(limiterKey, mapped.retryAfterMs);
              throw mapped;
            }
          },
          { maxAttempts: options.maxAttempts ?? 3, clock },
        );
        outcome.rowsFetched += page.items.length;
        const records = adapter.normalize(resource, page.items, refreshCtx);
        if (records.length > 0) outcome.rowsWritten += await sink.write(records, { resource });
        if (!page.nextCursor) break;
        if (seenCursors.has(page.nextCursor)) {
          throw new ProviderError(
            "invalid_response",
            "The provider repeated a page cursor, so the sync stopped to avoid looping.",
          );
        }
        seenCursors.add(page.nextCursor);
        cursor = page.nextCursor;
      }
      resourcesOk++;
    } catch (raw) {
      const error = toProviderError(raw);
      if (error.code === "plan_restricted") {
        // Not an error: this account simply does not have the feature. Say so and move on.
        outcome.unsupported.push({ resource, reason: error.safeMessage });
        resourcesOk++;
        continue;
      }
      outcome.errors.push({
        code: error.code,
        message: error.safeMessage,
        retryable: error.retryable,
        resource,
      });
      if (error.needsReconnect) outcome.needsReconnect = true;
      if (error.retryAfterMs) outcome.retryAfterMs = error.retryAfterMs;
      if (error.needsReconnect) break outer;
    }
  }

  outcome.status =
    outcome.errors.length === 0 ? "succeeded" : resourcesOk > 0 ? "partial" : "failed";
  return outcome;
}
