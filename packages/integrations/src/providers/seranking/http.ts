import { ProviderError, errorFromStatus } from "../../framework/errors";
import type { Credentials } from "../../framework/types";
import { SERANKING_API_BASE, SERANKING_MIN_INTERVAL_MS, type SeRankingConfig } from "./config";

type FetchLike = typeof fetch;
export type SeRankingDeps = {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The documented 403 messages that mean the token itself is bad (the others mean "not on your plan"). */
const BAD_TOKEN = /no token|incorrect token|invalid token/i;

/**
 * SE Ranking calls. The API allows 5 requests per second for ALL methods and punishes repeated excess
 * with a 10 minute block, and one adapter page can need several calls, so the client paces itself:
 * calls are spaced at least SERANKING_MIN_INTERVAL_MS apart, in this process.
 */
export function createSeRankingHttp(config: SeRankingConfig = {}, deps: SeRankingDeps = {}) {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? Date.now;
  let last = 0;
  let queue: Promise<unknown> = Promise.resolve();

  /** Serialise and space calls. */
  const paced = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(async () => {
      const wait = last + SERANKING_MIN_INTERVAL_MS - now();
      if (wait > 0) await sleep(wait);
      last = now();
      return work();
    });
    queue = run.catch(() => undefined);
    return run;
  };

  async function request(
    credentials: Credentials,
    path: string,
    query: Record<string, string | number | undefined> = {},
  ): Promise<unknown> {
    const apiKey = credentials.apiKey;
    if (!apiKey)
      throw new ProviderError(
        "auth_failed",
        "No SE Ranking API key is stored for this account. Connect it again.",
      );
    const url = new URL(`${config.apiBase ?? SERANKING_API_BASE}${path}`);
    for (const [k, v] of Object.entries(query))
      if (v !== undefined) url.searchParams.set(k, String(v));
    return paced(async () => {
      let res: Response;
      try {
        res = await doFetch(url, {
          headers: { authorization: `Token ${apiKey}`, accept: "application/json" },
          signal: AbortSignal.timeout(30_000),
        });
      } catch (error) {
        throw error instanceof Error && error.name === "TimeoutError"
          ? new ProviderError("timeout", "SE Ranking took too long to answer.")
          : new ProviderError("network", "SE Ranking could not be reached.");
      }
      if (!res.ok) throw await failure(res);
      try {
        return await res.json();
      } catch {
        throw new ProviderError("invalid_response", "SE Ranking returned data that is not JSON.");
      }
    });
  }
  return { request };
}

async function failure(res: Response): Promise<ProviderError> {
  let message = "";
  try {
    message = String(((await res.json()) as { message?: unknown }).message ?? "");
  } catch {
    // body is not JSON
  }
  if (res.status === 403) {
    if (BAD_TOKEN.test(message))
      return new ProviderError(
        "auth_failed",
        "SE Ranking rejected the API key. Connect the account again.",
        { status: 403 },
      );
    // "No access" / "Access denied": the key is fine but the plan or project does not include this.
    if (/no access|access denied/i.test(message))
      return new ProviderError(
        "plan_restricted",
        "SE Ranking says this account has no access to this feature (it may depend on the subscription).",
        { status: 403 },
      );
    return new ProviderError("auth_failed", "SE Ranking refused the request. Check the API key.", {
      status: 403,
    });
  }
  if (res.status === 429)
    // Repeated excess is punished with a block, so ask the runner to back off for a while.
    return new ProviderError(
      "rate_limited",
      "SE Ranking's rate limit (5 requests per second) was reached.",
      { status: 429, retryAfterMs: 15_000 },
    );
  return errorFromStatus(res.status);
}

export type SeRankingHttp = ReturnType<typeof createSeRankingHttp>;
