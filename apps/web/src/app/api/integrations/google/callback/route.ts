import { NextResponse, type NextRequest } from "next/server";
import { connectAccount, requirePermission } from "@automation/db";
import { GA4_SCOPE, GSC_SCOPE, ProviderError, exchangeGoogleCode } from "@automation/integrations";
import { getCipher } from "@/lib/cipher";
import { getWebEnv } from "@/lib/env";
import { verifyState } from "@/lib/oauth-state";
import { getProviders } from "@/lib/providers";
import { requireActor } from "@/lib/session";

export const dynamic = "force-dynamic";
const COOKIE = "google_oauth";
const SCOPES: Record<string, string> = {
  google_analytics_4: GA4_SCOPE,
  google_search_console: GSC_SCOPE,
};

/**
 * Finish "Sign in with Google": verify the signed state, the browser cookie and the person; exchange the
 * one-time code on the server; test the connection; store the encrypted refresh token. Tokens never
 * reach the browser.
 */
export async function GET(request: NextRequest) {
  const actor = await requireActor();
  const params = request.nextUrl.searchParams;
  const state = verifyState(getWebEnv().BETTER_AUTH_SECRET, params.get("state"));
  const cookieNonce = request.cookies.get(COOKIE)?.value;
  const clear = (r: NextResponse) => {
    r.cookies.set(COOKIE, "", { path: "/api/integrations/google", maxAge: 0 });
    return r;
  };
  const provider = state?.provider ?? "";
  if (
    !state ||
    !SCOPES[provider] ||
    state.userId !== actor.userId ||
    !cookieNonce ||
    cookieNonce !== state.nonce
  )
    return clear(
      NextResponse.redirect(
        new URL(
          "/integrations?error=" +
            encodeURIComponent("The Google sign-in could not be verified. Start again."),
          request.url,
        ),
      ),
    );
  const back = (error: string) =>
    clear(
      NextResponse.redirect(
        new URL(
          `/integrations/connect/${provider}?client=${encodeURIComponent(state.clientId)}&error=${encodeURIComponent(error)}`,
          request.url,
        ),
      ),
    );

  if (params.get("error")) return back("Google did not grant access.");
  const code = params.get("code");
  if (!code) return back("Google did not return an authorisation code.");

  try {
    await requirePermission(actor, state.clientId, "integration.manage");
    const { registry, googleOAuth } = getProviders();
    if (!googleOAuth) return back("Google sign-in is not configured on this server.");
    const { refreshToken, scope } = await exchangeGoogleCode(googleOAuth, code);
    // Google can return fewer scopes than asked for (granular consent): check the one we need was granted.
    if (!scope.split(/\s+/).includes(SCOPES[provider]!))
      return back("Read-only access was not granted. Connect again and allow it.");
    const credentials = { kind: "oauth", refreshToken, scope };
    const probe = await registry
      .get(provider, "live")
      .testConnection(credentials, { accountId: "setup", clientId: state.clientId });
    if (!probe.ok) return back(probe.error.safeMessage);
    const { id } = await connectAccount(
      actor,
      {
        clientId: state.clientId,
        integrationKey: provider,
        externalAccountId: probe.externalAccountId,
        displayName: probe.displayName,
        credentials,
        scopes: [...probe.grantedScopes],
        mock: false,
      },
      getCipher(),
    );
    return clear(NextResponse.redirect(new URL(`/integrations/${id}`, request.url)));
  } catch (error) {
    return back(
      error instanceof ProviderError ? error.safeMessage : "The connection could not be completed.",
    );
  }
}
