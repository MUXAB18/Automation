import {
  claimNextAiJob,
  createMockAiProvider,
  executeAiJob,
  reapStaleAiJobs,
  type AiProvider,
} from "@automation/db";
import { aiRuntimeFromEnv, type WorkerEnv } from "@automation/config";
import { createAiProvider } from "@automation/integrations";

export const AI_QUEUE = "ai-generation";
const MAX_JOBS_PER_TICK = 5;

/** The provider the environment selects. "mock" is the default: no key needed, nothing leaves the machine. */
export function providerFromEnv(env: WorkerEnv): AiProvider {
  if (env.AI_PROVIDER === "mock") return createMockAiProvider();
  const real = createAiProvider(
    env.AI_PROVIDER === "anthropic"
      ? { provider: "anthropic", apiKey: env.AI_API_KEY!, baseUrl: env.AI_BASE_URL }
      : { provider: "openai_compatible", apiKey: env.AI_API_KEY, baseUrl: env.AI_BASE_URL! },
  );
  return real as unknown as AiProvider;
}

/** One tick: put lost jobs back, then run waiting jobs (retries whose time has come included). */
export async function runAiTick(env: WorkerEnv, provider = providerFromEnv(env)) {
  const reaped = await reapStaleAiJobs();
  const runtime = aiRuntimeFromEnv(env);
  let executed = 0;
  for (; executed < MAX_JOBS_PER_TICK; executed++) {
    const id = await claimNextAiJob();
    if (!id) break;
    await executeAiJob(id, provider, runtime); // never throws: failures are recorded on the job
  }
  return { reaped, executed };
}
