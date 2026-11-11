import { toProviderError, type ProviderError } from "./errors";
import { systemClock, type Clock } from "./rate-limiter";

export type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  clock?: Clock;
  /** 0..1 random source, injectable for tests. */
  random?: () => number;
  onRetry?: (error: ProviderError, attempt: number, delayMs: number) => void;
};

/**
 * Run `operation`, retrying only errors that are retryable (rate limit, 5xx, timeout, network).
 * A provider-supplied Retry-After wins over our own exponential backoff. Non-retryable errors, such as
 * a revoked token, are thrown at once: retrying them only hammers a provider that already said no.
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 500, maxDelayMs = 30_000, random = Math.random } = options;
  const clock = options.clock ?? systemClock;
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation(attempt);
    } catch (raw) {
      const error = toProviderError(raw);
      if (!error.retryable || attempt >= maxAttempts) throw error;
      // A provider asking for a long pause (quota, rate window) is not worth blocking a run for: give up
      // now and let the scheduler try again later.
      if (error.retryAfterMs !== undefined && error.retryAfterMs > maxDelayMs) throw error;
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delay = Math.min(
        maxDelayMs,
        error.retryAfterMs ?? backoff / 2 + (random() * backoff) / 2,
      );
      options.onRetry?.(error, attempt, delay);
      await clock.sleep(delay);
    }
  }
}
