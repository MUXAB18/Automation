import "server-only";
import { aiEnvSchema, aiRuntimeFromEnv, loadEnv } from "@automation/config";

/** Which provider and model new generations use, and the default limits. The key itself is only ever in the worker. */
let cached: ReturnType<typeof aiRuntimeFromEnv> | undefined;
export function getAiConfig() {
  cached ??= aiRuntimeFromEnv(loadEnv(aiEnvSchema));
  return cached;
}
