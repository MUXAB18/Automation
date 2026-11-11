import { ProviderError, errorFromStatus } from "../../framework/errors";
import type { AdapterContext, Credentials } from "../../framework/types";
import { GHL_API_BASE, GHL_VERSION, type GhlConfig } from "./config";
import {
  credentialsFromToken,
  credentialsToRecord,
  parseGhlCredentials,
  refreshGhlAccessToken,
} from "./oauth";

type FetchLike = typeof fetch;

export type GhlRequest = {
  method?: "GET" | "POST";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  version?: string;
};

export type GhlDeps = { fetch?: FetchLike; now?: () => Date };

/** Refresh this long before the token really expires, so a call never starts with a stale one. */
const REFRESH_MARGIN_MS = 5 * 60_000;
const DAILY_RESET_GUESS_MS = 60 * 60_000;

/**
 * One authenticated GoHighLevel call: refreshes an expiring token first, retries once with a fresh
 * token on a 401, and maps rate-limit headers and statuses to the shared error vocabulary.
 * Returns parsed JSON. The latest credentials are reported through `ctx.onCredentialsRefreshed`.
 */
export function createGhlHttp(config: GhlConfig, deps: GhlDeps = {}) {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());

  async function refresh(credentials: Credentials, ctx: AdapterContext): Promise<Credentials> {
    const current = parseGhlCredentials(credentials);
    const token = await refreshGhlAccessToken(config, current.refreshToken, doFetch);
    const next = credentialsFromToken(token, current, now());
    const record = credentialsToRecord(next);
    // Store BEFORE using it: the old refresh token is already dead, so losing this one would lock the account out.
    await ctx.onCredentialsRefreshed?.(record, { expiresAt: next.expiresAt });
    return record;
  }

  async function send(credentials: Credentials, req: GhlRequest): Promise<Response> {
    const creds = parseGhlCredentials(credentials);
    const url = new URL(`${config.apiBase ?? GHL_API_BASE}${req.path}`);
    for (const [k, v] of Object.entries(req.query ?? {}))
      if (v !== undefined) url.searchParams.set(k, String(v));
    try {
      return await doFetch(url, {
        method: req.method ?? "GET",
        headers: {
          authorization: `Bearer ${creds.accessToken}`,
          version: req.version ?? GHL_VERSION,
          accept: "application/json",
          ...(req.body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw error instanceof Error && error.name === "TimeoutError"
        ? new ProviderError("timeout", "GoHighLevel took too long to answer.")
        : new ProviderError("network", "GoHighLevel could not be reached.");
    }
  }

  function failure(res: Response): ProviderError {
    // Documented headers: X-RateLimit-Interval-Milliseconds, -Remaining, -Max, -Limit-Daily, -Daily-Remaining.
    if (res.status === 429) {
      if (res.headers.get("x-ratelimit-daily-remaining") === "0")
        return new ProviderError(
          "quota_exhausted",
          "GoHighLevel's daily request limit is used up.",
          {
            status: 429,
            retryAfterMs: DAILY_RESET_GUESS_MS,
          },
        );
      const interval = Number(res.headers.get("x-ratelimit-interval-milliseconds"));
      return new ProviderError("rate_limited", "GoHighLevel's rate limit was reached.", {
        status: 429,
        retryAfterMs: Number.isFinite(interval) && interval > 0 ? interval : 10_000,
      });
    }
    return errorFromStatus(res.status);
  }

  async function request(
    credentials: Credentials,
    ctx: AdapterContext,
    req: GhlRequest,
  ): Promise<unknown> {
    let creds = credentials;
    const expiresAt = Date.parse(parseGhlCredentials(creds).expiresAt);
    let refreshed = false;
    if (!Number.isFinite(expiresAt) || expiresAt - now().getTime() < REFRESH_MARGIN_MS) {
      creds = await refresh(creds, ctx);
      refreshed = true;
    }
    let res = await send(creds, req);
    if (res.status === 401 && !refreshed) {
      creds = await refresh(creds, ctx);
      res = await send(creds, req);
    }
    if (!res.ok) throw failure(res);
    try {
      return await res.json();
    } catch {
      throw new ProviderError("invalid_response", "GoHighLevel returned data that is not JSON.");
    }
  }

  return { request };
}

export type GhlHttp = ReturnType<typeof createGhlHttp>;
