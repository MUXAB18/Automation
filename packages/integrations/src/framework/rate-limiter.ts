/**
 * Token-bucket limiter, one bucket per key (e.g. `provider:account`). `acquire` waits until a token
 * is available, so callers never exceed what the provider allows. Clock and sleep are injectable.
 */
export type RateLimit = {
  /** Sustained requests per second. */
  perSecond: number;
  /** Largest burst. Defaults to perSecond (at least 1). */
  burst?: number;
};

export type Clock = { now(): number; sleep(ms: number): Promise<void> };
export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class RateLimiter {
  private buckets = new Map<string, { tokens: number; updated: number; blockedUntil: number }>();
  constructor(
    private readonly limit: RateLimit,
    private readonly clock: Clock = systemClock,
  ) {
    if (!(limit.perSecond > 0)) throw new Error("perSecond must be positive");
  }
  private get capacity() {
    return Math.max(1, this.limit.burst ?? this.limit.perSecond);
  }
  private bucket(key: string) {
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.capacity, updated: this.clock.now(), blockedUntil: 0 };
      this.buckets.set(key, b);
    }
    return b;
  }
  /** Take one token, waiting if needed. */
  async acquire(key: string): Promise<void> {
    for (;;) {
      const b = this.bucket(key);
      const now = this.clock.now();
      b.tokens = Math.min(
        this.capacity,
        b.tokens + ((now - b.updated) / 1000) * this.limit.perSecond,
      );
      b.updated = now;
      const blockedFor = b.blockedUntil - now;
      if (blockedFor <= 0 && b.tokens >= 1) {
        b.tokens -= 1;
        return;
      }
      const refillWait = Math.ceil(((1 - b.tokens) / this.limit.perSecond) * 1000);
      await this.clock.sleep(Math.max(blockedFor, refillWait, 1));
    }
  }
  /** The provider told us to back off (429 + Retry-After): hold this key until then. */
  penalize(key: string, ms: number) {
    const b = this.bucket(key);
    b.blockedUntil = Math.max(b.blockedUntil, this.clock.now() + ms);
  }
}
