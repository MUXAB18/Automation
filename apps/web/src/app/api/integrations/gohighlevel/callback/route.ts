import { NextResponse, type NextRequest } from "next/server";
import { connectAccount, requirePermission } from "@automation/db";
import {
  ProviderError,
  credentialsFromToken,
  credentialsToRecord,
  exchangeGhlAuthorizationCode,
  grantedScopesOf,
} from "@automation/integrations";
import { getCipher } from "@/lib/cipher";
import { getWebEnv } from "@/lib/env";
import { verifyState } from "@/lib/oauth-state";
import { getProviders } from "@/lib/providers";
import { requireActor } from "@/lib/session";

export const dynamic = "force-dynamic";
const COOKIE = "ghl_oauth";

/**
 * Finish the install: verify the signed state, the browser cookie and the person; exchange the one-time
 * code on the server; test the connection; store the encrypted credentials. Tokens never reach the browser.
 */
export async function GET(request: NextRequest) {
  const actor = await requireActor();
  const params = request.nextUrl.searchParams;
  const state = verifyState(getWebEnv().BETTER_AUTH_SECRET, params.get("state"));
  const cookieNonce = request.cookies.get(COOKIE)?.value;
  // Fail closed: no valid state, a state from another browser, or one that belongs to someone else.
  if (
    !state ||
    state.provider !== "gohighlevel" ||
    state.userId !== actor.userId ||
    !cookieNonce ||
    cookieNonce !== state.nonce
  ) {
    return clear(
      NextResponse.redirect(
        new URL(
          "/integrations?error=" +
            encodeURIComponent("The GoHighLevel sign-in could not be verified. Start again."),
          request.url,
        ),
      ),
    );
  }
  const back = (error: string) =>
    clear(
      NextResponse.redirect(
        new URL(
          `/integrations/connect/gohighlevel?client=${encodeURIComponent(state.clientId)}&error=${encodeURIComponent(error)}`,
          request.url,
        ),
      ),
    );

  if (params.get("error")) return back("GoHighLevel did not grant access.");
  const code = params.get("code");
  if (!code) return back("GoHighLevel did not return an authorisation code.");

  try {
    await requirePermission(actor, state.clientId, "integration.manage");
    const { registry, ghlConfig } = getProviders();
    if (!ghlConfig || !registry.hasLive("gohighlevel"))
      return back("GoHighLevel is not configured on this server.");

    const token = await exchangeGhlAuthorizationCode(ghlConfig, code);
    const credentials = credentialsToRecord(credentialsFromToken(token));
    const adapter = registry.get("gohighlevel", "live");
    const probe = await adapter.testConnection(credentials, {
      accountId: "setup",
      clientId: state.clientId,
    });
    if (!probe.ok) return back(probe.error.safeMessage);

    const { id } = await connectAccount(
      actor,
      {
        clientId: state.clientId,
        integrationKey: "gohighlevel",
        externalAccountId: probe.externalAccountId,
        displayName: probe.displayName,
        credentials,
        scopes: [...grantedScopesOf({ scope: credentials.scope ?? "" })],
        mock: false,
        tokenExpiresAt: credentials.expiresAt ? new Date(credentials.expiresAt) : null,
      },
      getCipher(),
    );
    return clear(NextResponse.redirect(new URL(`/integrations/${id}`, request.url)));
  } catch (error) {
    // Only fixed, safe messages are ever shown; anything else is generic.
    return back(
      error instanceof ProviderError ? error.safeMessage : "The connection could not be completed.",
    );
  }
}

function clear(response: NextResponse) {
  response.cookies.set(COOKIE, "", { path: "/api/integrations/gohighlevel", maxAge: 0 });
  return response;
}
