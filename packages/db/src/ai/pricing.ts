import type { AiRuntimeConfig } from "./provider";

/**
 * Estimated cost in micro-USD (1e-6). Prices come from configuration (AI_PRICING_JSON); there is no built-in
 * table because list prices change. A model without a price has no estimate (null), never a made-up one.
 */
export function estimateCostMicros(
  model: string,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
  pricing: AiRuntimeConfig["pricing"],
): bigint | null {
  if (model.startsWith("mock")) return 0n;
  const price = pricing?.[model];
  if (!price || inputTokens == null || outputTokens == null) return null;
  // USD per million tokens == micro-USD per token.
  return BigInt(Math.round(inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok));
}
