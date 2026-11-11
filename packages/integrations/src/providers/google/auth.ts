import { createHash, createSign } from "node:crypto";
import { z } from "zod";
import { ProviderError, errorFromStatus } from "../../framework/errors";
import type { Credentials } from "../../framework/types";
import {
  GOOGLE_AUTH_URL,
  GOOGLE_TOKEN_URL,
  type GoogleCredentials,
  type GoogleOAuthConfig,
} from "./config";

type FetchLike = typeof fetch;
export type GoogleAuthDeps = { fetch?: FetchLike; now?: () => number };

/** Consent URL. `access_type=offline` + `prompt=consent` so Google returns a refresh token. */
export function buildGoogleInstallUrl(
  config: GoogleOAuthConfig,
  scope: string,
  state: string,
): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scope);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

const tokenBody = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
});

async function postToken(params: Record<string, string>, deps: GoogleAuthDeps) {
  const doFetch = deps.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw error instanceof Error && error.name === "TimeoutError"
      ? new ProviderError("timeout", "Google took too long to answer.")
      : new ProviderError("network", "Google could not be reached.");
  }
  if (!res.ok) {
    let code = "";
    try {
      code = String(((await res.json()) as { error?: unknown }).error ?? "");
    } catch {
      // not JSON
    }
    // invalid_grant: revoked, expired, or the account changed password. A person must sign in again.
    if (code === "invalid_grant")
      throw new ProviderError(
        "auth_failed",
        "Google rejected the stored access (revoked or expired). Connect the account again.",
        { status: res.status },
      );
    if (code === "invalid_client" || code === "unauthorized_client" || code === "invalid_scope")
      throw new ProviderError(
        "invalid_request",
        "The platform's Google OAuth client is not set up correctly for this request.",
        { status: res.status },
      );
    throw errorFromStatus(res.status);
  }
  const parsed = tokenBody.safeParse(await res.json().catch(() => null));
  if (!parsed.success)
    throw new ProviderError("invalid_response", "Google returned an unexpected token response.");
  return parsed.data;
}

/** Exchange the one-time code. Refresh tokens are only returned on consent, so a missing one is an error. */
export async function exchangeGoogleCode(
  config: GoogleOAuthConfig,
  code: string,
  deps: GoogleAuthDeps = {},
) {
  const body = await postToken(
    {
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    },
    deps,
  );
  if (!body.refresh_token)
    throw new ProviderError(
      "invalid_request",
      "Google did not return a refresh token. Remove this app's access in your Google account settings, then connect again.",
    );
  return { refreshToken: body.refresh_token, scope: body.scope ?? "" };
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

/** Service account assertion: header.claims signed RS256, lifetime one hour (the documented maximum). */
export function signServiceAccountAssertion(
  key: { clientEmail: string; privateKey: string },
  scope: string,
  nowMs: number,
): string {
  const iat = Math.floor(nowMs / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({ iss: key.clientEmail, scope, aud: GOOGLE_TOKEN_URL, iat, exp: iat + 3600 }),
  )}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  return `${unsigned}.${b64url(signer.sign(key.privateKey))}`;
}

const stored = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("oauth"),
    refreshToken: z.string().min(1),
    scope: z.string().default(""),
  }),
  z.object({
    kind: z.literal("service_account"),
    clientEmail: z.string().min(3),
    privateKey: z.string().min(20),
  }),
]);

export function parseGoogleCredentials(raw: Credentials): GoogleCredentials {
  const parsed = stored.safeParse(raw);
  if (!parsed.success)
    throw new ProviderError(
      "auth_failed",
      "The stored Google connection is incomplete. Connect the account again.",
    );
  return parsed.data;
}

/** Validate a pasted service account key file. Returns only the two fields that are used. */
export function parseServiceAccountKey(json: string): { clientEmail: string; privateKey: string } {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new ProviderError("invalid_request", "That is not valid JSON. Paste the whole key file.");
  }
  const parsed = z
    .object({
      client_email: z.string().email(),
      private_key: z.string().includes("BEGIN PRIVATE KEY"),
    })
    .safeParse(data);
  if (!parsed.success)
    throw new ProviderError(
      "invalid_request",
      "That does not look like a Google service account key (client_email and private_key are required).",
    );
  return { clientEmail: parsed.data.client_email, privateKey: parsed.data.private_key };
}

const cache = new Map<string, { token: string; expiresAt: number }>();
const EARLY_MS = 60_000;

/** A short-lived access token for the credentials, cached in memory until just before it expires. */
export async function getGoogleAccessToken(
  credentials: Credentials,
  scope: string,
  oauth: GoogleOAuthConfig | null,
  deps: GoogleAuthDeps = {},
  options: { forceRefresh?: boolean } = {},
): Promise<string> {
  const creds = parseGoogleCredentials(credentials);
  const now = deps.now?.() ?? Date.now();
  const secret = creds.kind === "oauth" ? creds.refreshToken : creds.clientEmail;
  const key = createHash("sha256").update(`${creds.kind}|${secret}|${scope}`).digest("hex");
  const hit = cache.get(key);
  if (!options.forceRefresh && hit && hit.expiresAt - EARLY_MS > now) return hit.token;

  let body;
  if (creds.kind === "oauth") {
    if (!oauth)
      throw new ProviderError(
        "invalid_request",
        "Google sign-in is not configured on this server.",
      );
    body = await postToken(
      {
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret,
        refresh_token: creds.refreshToken,
        grant_type: "refresh_token",
      },
      deps,
    );
  } else {
    body = await postToken(
      {
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: signServiceAccountAssertion(creds, scope, now),
      },
      deps,
    );
  }
  cache.set(key, { token: body.access_token, expiresAt: now + body.expires_in * 1000 });
  return body.access_token;
}

export const clearGoogleTokenCache = () => cache.clear();
