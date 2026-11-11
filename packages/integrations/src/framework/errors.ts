/**
 * One error vocabulary for every provider. Adapters map whatever the provider returned (HTTP status,
 * SDK error, timeout) to a ProviderError; only `safeMessage` is ever stored or shown. Raw provider
 * bodies can echo tokens or customer data, so they never travel with the error.
 */

export const PROVIDER_ERROR_CODES = [
  "auth_failed",
  "insufficient_scope",
  /** The account or plan does not include this feature. Reconnecting will not help; it is reported as unsupported. */
  "plan_restricted",
  /** The connection works but the account has no access to THIS resource (a property, a site). Reported per resource, not as a failed connection. */
  "access_denied",
  "rate_limited",
  "quota_exhausted",
  "not_found",
  "invalid_request",
  "provider_unavailable",
  "timeout",
  "network",
  "invalid_response",
  "unknown",
] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

/** Codes where trying again later can succeed without anyone changing anything. */
const RETRYABLE = new Set<ProviderErrorCode>([
  "rate_limited",
  "quota_exhausted",
  "provider_unavailable",
  "timeout",
  "network",
]);
/**
 * After a request that CREATES something, these mean "we do not know whether it happened". They must
 * never be retried blindly: a person checks first. Everything else is a clear yes/no answer.
 */
const OUTCOME_UNKNOWN = new Set<ProviderErrorCode>([
  "provider_unavailable",
  "timeout",
  "network",
  "invalid_response",
  "unknown",
]);
/** Codes that mean a person must reconnect or fix the account. */
const NEEDS_RECONNECT = new Set<ProviderErrorCode>(["auth_failed", "insufficient_scope"]);

export class ProviderError extends Error {
  readonly retryable: boolean;
  readonly needsReconnect: boolean;
  constructor(
    public readonly code: ProviderErrorCode,
    public readonly safeMessage: string,
    public readonly options: { status?: number; retryAfterMs?: number } = {},
  ) {
    super(safeMessage);
    this.name = "ProviderError";
    this.retryable = RETRYABLE.has(code);
    this.needsReconnect = NEEDS_RECONNECT.has(code);
  }
  /** True when a create request may have succeeded even though we got an error back. */
  get outcomeUnknown() {
    return OUTCOME_UNKNOWN.has(this.code);
  }
  get status() {
    return this.options.status;
  }
  get retryAfterMs() {
    return this.options.retryAfterMs;
  }
}

const MESSAGES: Record<ProviderErrorCode, string> = {
  auth_failed: "The provider rejected the credentials. Reconnect the account.",
  access_denied:
    "The connected Google account has no access to this property. Grant it access in Google and sync again.",
  plan_restricted: "This feature is not available on the connected account or plan.",
  insufficient_scope:
    "The connection is missing permissions this feature needs. Reconnect and approve them.",
  rate_limited: "The provider's rate limit was reached. It will be retried later.",
  quota_exhausted: "The provider's usage quota is used up. It will be retried after it resets.",
  not_found: "The provider could not find the requested resource.",
  invalid_request: "The provider rejected the request.",
  provider_unavailable: "The provider is having problems right now.",
  timeout: "The provider took too long to answer.",
  network: "The provider could not be reached.",
  invalid_response: "The provider returned data in an unexpected shape.",
  unknown: "Something unexpected went wrong talking to the provider.",
};

export const defaultMessage = (code: ProviderErrorCode) => MESSAGES[code];

/** Map an HTTP status to a ProviderError. Adapters call this, then refine if the provider says more. */
export function errorFromStatus(status: number, retryAfterSeconds?: number): ProviderError {
  const retryAfterMs =
    retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds)
      ? Math.max(0, retryAfterSeconds) * 1000
      : undefined;
  const code: ProviderErrorCode =
    status === 401
      ? "auth_failed"
      : status === 403
        ? "insufficient_scope"
        : status === 404
          ? "not_found"
          : status === 429
            ? "rate_limited"
            : status === 408 || status === 504
              ? "timeout"
              : status >= 500
                ? "provider_unavailable"
                : status >= 400
                  ? "invalid_request"
                  : "unknown";
  return new ProviderError(code, MESSAGES[code], { status, retryAfterMs });
}

/** Anything thrown becomes a ProviderError; unknown errors never leak their message. */
export function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
    return new ProviderError("timeout", MESSAGES.timeout);
  if (error instanceof TypeError) return new ProviderError("network", MESSAGES.network);
  return new ProviderError("unknown", MESSAGES.unknown);
}
