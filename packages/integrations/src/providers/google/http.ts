import { ProviderError, errorFromStatus } from "../../framework/errors";
import type { Credentials } from "../../framework/types";
import { getGoogleAccessToken, type GoogleAuthDeps } from "./auth";
import type { GoogleOAuthConfig } from "./config";

export type GoogleHttpDeps = GoogleAuthDeps;

type GoogleErrorBody = {
  error?: {
    message?: string;
    status?: string;
    errors?: { reason?: string }[];
    details?: { reason?: string }[];
  };
};

/** Map a Google API error to the shared vocabulary. Messages come from fixed text, never from the response. */
export async function googleFailure(res: Response): Promise<ProviderError> {
  let body: GoogleErrorBody = {};
  try {
    body = (await res.json()) as GoogleErrorBody;
  } catch {
    // not JSON
  }
  const reasons = [...(body.error?.errors ?? []), ...(body.error?.details ?? [])].map(
    (r) => r.reason ?? "",
  );
  const message = body.error?.message ?? "";
  const status = body.error?.status ?? "";

  if (res.status === 401)
    return new ProviderError("auth_failed", "Google rejected the access token.", { status: 401 });
  if (res.status === 403) {
    if (reasons.some((r) => /accessNotConfigured|SERVICE_DISABLED/i.test(r)))
      return new ProviderError(
        "invalid_request",
        "The Google API is not enabled for the platform's Google Cloud project.",
        { status: 403 },
      );
    if (reasons.some((r) => /rateLimit|quotaExceeded|dailyLimit/i.test(r)))
      return new ProviderError("rate_limited", "Google's rate limit was reached.", {
        status: 403,
        retryAfterMs: 30_000,
      });
    return new ProviderError(
      "access_denied",
      "The connected Google account has no access to this property.",
      { status: 403 },
    );
  }
  if (res.status === 429 || status === "RESOURCE_EXHAUSTED") {
    // GA4 reports which token bucket ran dry; a daily or hourly bucket will not refill within this run.
    if (/per day/i.test(message))
      return new ProviderError(
        "quota_exhausted",
        "The property's daily Google Analytics quota is used up.",
        { status: 429, retryAfterMs: 3_600_000 },
      );
    if (/per hour/i.test(message))
      return new ProviderError(
        "quota_exhausted",
        "The property's hourly Google Analytics quota is used up.",
        { status: 429, retryAfterMs: 900_000 },
      );
    return new ProviderError("rate_limited", "Google's rate limit was reached.", {
      status: 429,
      retryAfterMs: 10_000,
    });
  }
  return errorFromStatus(res.status);
}

/**
 * Authenticated Google API call: gets (or reuses) an access token, retries once with a fresh one on a 401
 * (the token may have been revoked mid-run), and maps failures to ProviderError.
 */
export function createGoogleHttp(oauth: GoogleOAuthConfig | null, deps: GoogleHttpDeps = {}) {
  const doFetch = deps.fetch ?? fetch;

  async function send(
    url: string,
    token: string,
    init: { method?: "GET" | "POST"; body?: unknown },
  ): Promise<Response> {
    try {
      return await doFetch(url, {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw error instanceof Error && error.name === "TimeoutError"
        ? new ProviderError("timeout", "Google took too long to answer.")
        : new ProviderError("network", "Google could not be reached.");
    }
  }

  async function request(
    credentials: Credentials,
    scope: string,
    url: string,
    init: { method?: "GET" | "POST"; body?: unknown } = {},
  ): Promise<unknown> {
    let token = await getGoogleAccessToken(credentials, scope, oauth, deps);
    let res = await send(url, token, init);
    if (res.status === 401) {
      token = await getGoogleAccessToken(credentials, scope, oauth, deps, { forceRefresh: true });
      res = await send(url, token, init);
    }
    if (!res.ok) throw await googleFailure(res);
    try {
      return await res.json();
    } catch {
      throw new ProviderError("invalid_response", "Google returned data that is not JSON.");
    }
  }
  return { request };
}

export type GoogleHttp = ReturnType<typeof createGoogleHttp>;
