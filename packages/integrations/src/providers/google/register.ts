import type { AdapterRegistry } from "../../framework/registry";
import type { GoogleOAuthConfig } from "./config";
import { createGa4Adapter } from "./ga4";
import { createGoogleMockAdapter } from "./mock";
import { createSearchConsoleAdapter } from "./gsc";

/** The platform's Google OAuth client from environment variables, or null when sign-in is not configured. */
export function googleOAuthFromEnv(env: {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
}): GoogleOAuthConfig | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) return null;
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
  };
}

/**
 * Google adapters need no platform credentials for service accounts, so they are always live; OAuth
 * sign-in additionally needs the platform OAuth client. Development mocks produce realistic metrics.
 */
export function registerGoogle(registry: AdapterRegistry, oauth: GoogleOAuthConfig | null): void {
  registry.registerLive(createGa4Adapter(oauth));
  registry.registerLive(createSearchConsoleAdapter(oauth));
  registry.registerMock(createGoogleMockAdapter("ga4"));
  registry.registerMock(createGoogleMockAdapter("search_console"));
}
