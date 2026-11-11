import type { AdapterRegistry } from "../../framework/registry";
import { createGoHighLevelAdapter } from "./adapter";
import type { GhlConfig } from "./config";

/** The marketplace app's settings from environment variables, or null when GoHighLevel is not configured. */
export function ghlConfigFromEnv(env: {
  GHL_CLIENT_ID?: string;
  GHL_CLIENT_SECRET?: string;
  GHL_REDIRECT_URI?: string;
}): GhlConfig | null {
  if (!env.GHL_CLIENT_ID || !env.GHL_CLIENT_SECRET || !env.GHL_REDIRECT_URI) return null;
  return {
    clientId: env.GHL_CLIENT_ID,
    clientSecret: env.GHL_CLIENT_SECRET,
    redirectUri: env.GHL_REDIRECT_URI,
  };
}

/** Register the live adapter when configured. Returns whether it is now available. */
export function registerGoHighLevel(registry: AdapterRegistry, config: GhlConfig | null): boolean {
  if (!config) return false;
  registry.registerLive(createGoHighLevelAdapter(config));
  return true;
}
