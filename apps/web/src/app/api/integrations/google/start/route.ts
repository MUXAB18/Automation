import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@automation/db";
import { GA4_SCOPE, GSC_SCOPE, buildGoogleInstallUrl } from "@automation/integrations";
import { getWebEnv } from "@/lib/env";
import { createState } from "@/lib/oauth-state";
import { getProviders } from "@/lib/providers";
import { requireActor } from "@/lib/session";
import { QUOTAS, consumeUserQuota } from "@/lib/throttle";

export const dynamic = "force-dynamic";
const COOKIE = "google_oauth";
const SCOPES: Record<string, string> = {
  google_analytics_4: GA4_SCOPE,
  google_search_console: GSC_SCOPE,
};

/** Begin "Sign in with Google": authorise the person, bind a signed state to them, redirect to consent. */
export async function GET(request: NextRequest) {
  const actor = await requireActor();
  const clientId = request.nextUrl.searchParams.get("client") ?? "";
  const provider = request.nextUrl.searchParams.get("provider") ?? "";
  const back = (error: string) =>
    NextResponse.redirect(
      new URL(
        `/integrations/connect/${encodeURIComponent(provider)}?client=${encodeURIComponent(clientId)}&error=${encodeURIComponent(error)}`,
        request.url,
      ),
    );
  try {
    await requirePermission(actor, clientId, "integration.manage");
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
  if (
    !(await consumeUserQuota(
      QUOTAS.oauthStart.action,
      actor.userId,
      QUOTAS.oauthStart.limit,
      QUOTAS.oauthStart.windowMs,
    ))
  )
    return new NextResponse("Too many requests", {
      status: 429,
      headers: { "Retry-After": "600" },
    });
  const scope = SCOPES[provider];
  if (!scope) return new NextResponse("Not found", { status: 404 });
  const { googleOAuth } = getProviders();
  if (!googleOAuth)
    return back("Google sign-in is not configured on this server. Use a service account instead.");

  const { state, nonce } = createState(getWebEnv().BETTER_AUTH_SECRET, {
    userId: actor.userId,
    clientId,
    provider,
    write: false,
  });
  const response = NextResponse.redirect(buildGoogleInstallUrl(googleOAuth, scope, state));
  response.cookies.set(COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && getWebEnv().APP_URL.startsWith("https://"),
    path: "/api/integrations/google",
    maxAge: 600,
  });
  return response;
}
