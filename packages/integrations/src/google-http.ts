export type FetchLike = typeof fetch;

/** Thrown when Google rejects a stored refresh token; the connection must be re-authorised. */
export class GoogleReauthRequiredError extends Error {
  constructor(message = "Google access was revoked or expired; the client must reconnect") {
    super(message);
    this.name = "GoogleReauthRequiredError";
  }
}

export class GoogleApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export type HttpOptions = {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  baseDelayMs?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const retryable = (status: number) => status === 429 || (status >= 500 && status <= 599);

function retryDelay(res: Response | undefined, attempt: number, base: number): number {
  const header = Number(res?.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 60_000);
  return Math.min(base * 2 ** attempt + Math.random() * base, 60_000);
}

/**
 * fetch with exponential backoff on network errors, 429 and 5xx. Returns the final response
 * (callers decide what a non-2xx means). Request bodies must be re-sendable (strings).
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  {
    fetch: doFetch = fetch,
    sleep = defaultSleep,
    maxAttempts = 4,
    baseDelayMs = 500,
  }: HttpOptions = {},
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response | undefined;
    try {
      res = await doFetch(url, init);
      if (!retryable(res.status) || attempt + 1 >= maxAttempts) return res;
    } catch (error) {
      if (attempt + 1 >= maxAttempts) throw error;
    }
    await sleep(retryDelay(res, attempt, baseDelayMs));
  }
}

/** Authenticated JSON request. 401 means the access token is bad; other failures become GoogleApiError. */
export async function googleJson(
  url: string,
  accessToken: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
  http: HttpOptions = {},
): Promise<unknown> {
  const res = await fetchWithRetry(
    url,
    {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    },
    http,
  );
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? "";
    } catch {
      // non-JSON error body
    }
    throw new GoogleApiError(`Google API ${res.status}${detail ? `: ${detail}` : ""}`, res.status);
  }
  return res.json();
}
