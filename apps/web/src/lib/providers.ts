import "server-only";
import { ghlEnvSchema, googleEnvSchema, loadEnv } from "@automation/config";
import {
  defaultRegistry,
  ghlConfigFromEnv,
  googleOAuthFromEnv,
  registerGoHighLevel,
  registerGoogle,
  registerSeRanking,
  type GhlConfig,
  type GoogleOAuthConfig,
} from "@automation/integrations";

/** Provider setup for the web app: registers live adapters whose platform credentials are configured. */
let state:
  | { config: GhlConfig | null; google: GoogleOAuthConfig | null; publishingEnabled: boolean }
  | undefined;

export function getProviders() {
  if (!state) {
    const env = loadEnv(ghlEnvSchema);
    const config = ghlConfigFromEnv(env);
    registerGoHighLevel(defaultRegistry, config);
    registerSeRanking(defaultRegistry);
    const google = googleOAuthFromEnv(loadEnv(googleEnvSchema));
    registerGoogle(defaultRegistry, google);
    state = { config, google, publishingEnabled: env.GHL_PUBLISHING_ENABLED === "1" };
  }
  return {
    registry: defaultRegistry,
    ghlConfig: state.config,
    googleOAuth: state.google,
    publishingEnabled: state.publishingEnabled,
  };
}
