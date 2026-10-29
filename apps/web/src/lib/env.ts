import { loadEnv, webEnvSchema, type WebEnv } from "@automation/config";

let cached: WebEnv | undefined;

export function getWebEnv(): WebEnv {
  cached ??= loadEnv(webEnvSchema);
  return cached;
}
