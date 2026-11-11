import { z } from "zod";
import { ProviderError, errorFromStatus } from "../../framework/errors";
import type { Credentials } from "../../framework/types";
import {
  GHL_API_BASE,
  GHL_INSTALL_BASE,
  grantedScopesOf,
  type GhlConfig,
  type GhlCredentials,
} from "./config";

type FetchLike = typeof fetch;

/** The consent URL the person is sent to. Scopes are space-separated, per the docs. */
export function buildInstallUrl(
  config: GhlConfig,
  scopes: readonly string[],
  state: string,
): string {
  const url = new URL(`${config.installBase ?? GHL_INSTALL_BASE}/v2/oauth/chooselocation`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
  scope: z.string().default(""),
  userType: z.string().optional(),
  companyId: z.string().optional(),
  locationId: z.string().optional(),
  userId: z.string().optional(),
});
export type GhlTokenResponse = z.infer<typeof tokenResponse>;

async function postToken(
  config: GhlConfig,
  body: Record<string, string>,
  format: "json" | "form",
  doFetch: FetchLike,
): Promise<GhlTokenResponse> {
  let res: Response;
  try {
    res = await doFetch(`${config.apiBase ?? GHL_API_BASE}/oauth/token`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type":
          format === "json" ? "application/json" : "application/x-www-form-urlencoded",
      },
      body: format === "json" ? JSON.stringify(body) : new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw error instanceof Error && error.name === "TimeoutError"
      ? new ProviderError("timeout", "GoHighLevel took too long to answer.")
      : new ProviderError("network", "GoHighLevel could not be reached.");
  }
  if (!res.ok) {
    // 400/401 from the token endpoint means the code or refresh token is no good (used, expired, revoked).
    if (res.status === 400 || res.status === 401 || res.status === 403)
      throw new ProviderError(
        "auth_failed",
        "GoHighLevel rejected the authorisation. Connect the account again.",
        { status: res.status },
      );
    throw errorFromStatus(res.status);
  }
  const parsed = tokenResponse.safeParse(await res.json().catch(() => null));
  if (!parsed.success)
    throw new ProviderError(
      "invalid_response",
      "GoHighLevel returned an unexpected token response.",
    );
  return parsed.data;
}

/** Exchange the one-time code from the redirect. The docs show a JSON body for this grant. */
export function exchangeGhlAuthorizationCode(
  config: GhlConfig,
  code: string,
  doFetch: FetchLike = fetch,
) {
  return postToken(
    config,
    {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code,
      user_type: "Location",
      redirect_uri: config.redirectUri,
    },
    "json",
    doFetch,
  );
}

/** Refresh tokens ROTATE: the response carries a new one and the old one stops working. */
export function refreshGhlAccessToken(
  config: GhlConfig,
  refreshToken: string,
  doFetch: FetchLike = fetch,
) {
  return postToken(
    config,
    {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      user_type: "Location",
      redirect_uri: config.redirectUri,
    },
    "form",
    doFetch,
  );
}

/** Turn a token response into stored credentials. Only location-level installs are supported. */
export function credentialsFromToken(
  token: GhlTokenResponse,
  previous?: Pick<GhlCredentials, "locationId" | "companyId" | "userId" | "scope">,
  now: Date = new Date(),
): GhlCredentials {
  const locationId = token.locationId ?? previous?.locationId;
  if (token.userType === "Company" || !locationId)
    throw new ProviderError(
      "invalid_request",
      "This authorisation is for a whole agency. Install the app on a specific GoHighLevel location (sub-account) instead.",
    );
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: new Date(now.getTime() + token.expires_in * 1000).toISOString(),
    locationId,
    companyId: token.companyId ?? previous?.companyId,
    userId: token.userId ?? previous?.userId,
    scope: token.scope || previous?.scope || "",
  };
}

const stored = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.string().min(1),
  locationId: z.string().min(1),
  companyId: z.string().optional(),
  userId: z.string().optional(),
  scope: z.string().default(""),
});

/** Credentials come back from storage as a string map; validate before trusting them. */
export function parseGhlCredentials(raw: Credentials): GhlCredentials {
  const parsed = stored.safeParse(raw);
  if (!parsed.success)
    throw new ProviderError(
      "auth_failed",
      "The stored GoHighLevel connection is incomplete. Connect the account again.",
    );
  return parsed.data;
}

export const credentialsToRecord = (c: GhlCredentials): Record<string, string> =>
  Object.fromEntries(Object.entries(c).filter(([, v]) => typeof v === "string")) as Record<
    string,
    string
  >;

export { grantedScopesOf };
