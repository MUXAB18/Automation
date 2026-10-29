import { z } from "zod";
import {
  GoogleApiError,
  GoogleReauthRequiredError,
  fetchWithRetry,
  type HttpOptions,
} from "./google-http";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

const tokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

export type AccessToken = { accessToken: string; expiresAt: Date };

/**
 * Exchange a refresh token for a short-lived access token. `invalid_grant` (revoked, expired or
 * password-reset) throws GoogleReauthRequiredError so callers can mark the connection needs_reauth.
 * Secrets are never included in thrown messages.
 */
export async function refreshAccessToken(
  creds: { clientId: string; clientSecret: string; refreshToken: string },
  http: HttpOptions & { now?: () => Date } = {},
): Promise<AccessToken> {
  const res = await fetchWithRetry(
    TOKEN_URL,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: creds.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    },
    http,
  );

  if (!res.ok) {
    let code = "";
    try {
      code = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      // non-JSON body
    }
    if (code === "invalid_grant") throw new GoogleReauthRequiredError();
    throw new GoogleApiError(
      `Google token refresh failed (${res.status}${code ? ` ${code}` : ""})`,
      res.status,
    );
  }

  const body = tokenResponse.parse(await res.json());
  const now = http.now?.() ?? new Date();
  // Refresh a minute early so a token never expires mid-request.
  return {
    accessToken: body.access_token,
    expiresAt: new Date(now.getTime() + (body.expires_in - 60) * 1000),
  };
}
