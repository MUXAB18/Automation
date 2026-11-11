import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@automation/db";
import { GHL_READ_SCOPES, GHL_SCOPES, buildInstallUrl } from "@automation/integrations";
import { getWebEnv } from "@/lib/env";
import { createState } from "@/lib/oauth-state";
import { getProviders } from "@/lib/providers";
import { requireActor } from "@/lib/session";
import { QUOTAS, consumeUserQuota } from "@/lib/throttle";

export const dynamic = "force-dynamic";
const COOKIE = "ghl_oauth";

/** Begin the GoHighLevel install: authorise the person, bind a signed state to them, redirect to consent. */
export async function GET(request: NextRequest) {
  const actor = await requireActor();
  const clientId = request.nextUrl.searchParams.get("client") ?? "";
  const write = request.nextUrl.searchParams.get("posting") === "1";
  const back = (error: string) =>
    NextResponse.redirect(
      new URL(
        `/integrations/connect/gohighlevel?client=${encodeURIComponent(clientId)}&error=${encodeURIComponent(error)}`,
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
  const { ghlConfig, publishingEnabled } = getProviders();
  if (!ghlConfig) return back("GoHighLevel is not configured on this server.");
  if (write && !publishingEnabled) return back("Posting is switched off on this server.");

  const { state, nonce } = createState(getWebEnv().BETTER_AUTH_SECRET, {
    userId: actor.userId,
    clientId,
    provider: "gohighlevel",
    write,
  });
  const scopes = write ? [...GHL_READ_SCOPES, GHL_SCOPES.socialPostsWrite] : [...GHL_READ_SCOPES];
  const response = NextResponse.redirect(buildInstallUrl(ghlConfig, scopes, state));
  response.cookies.set(COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/integrations/gohighlevel",
    maxAge: 600,
  });
  return response;
}
