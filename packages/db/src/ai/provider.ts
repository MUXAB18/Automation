/**
 * The AI provider contract. The platform talks to this interface only; adapters for real providers live in
 * `@automation/integrations` and implement it structurally, and the mock below is used in tests and local
 * development so no API key is ever required.
 */
export type AiProviderRequest = {
  model: string;
  system: string;
  prompt: string;
  maxOutputTokens: number;
  /** The generation task and its validated input. Real providers ignore them; the mock uses them. */
  task: string;
  meta: Record<string, unknown>;
  signal?: AbortSignal;
};

export type AiProviderResult = {
  /** The model's reply: a JSON document for every task. */
  text: string;
  inputTokens?: number;
  outputTokens?: number;
};

export interface AiProvider {
  readonly key: string;
  generate(request: AiProviderRequest): Promise<AiProviderResult>;
}

/** Errors an adapter throws. Anything with `retryable` and `safeMessage` is understood (ProviderError has both). */
export class AiProviderError extends Error {
  constructor(
    public readonly safeMessage: string,
    public readonly retryable = false,
  ) {
    super(safeMessage);
    this.name = "AiProviderError";
  }
}

export type AiRuntimeConfig = {
  provider: string;
  model: string;
  defaultMonthlyRequests: number;
  /** USD; 0 = no default cost cap. */
  defaultMonthlyCostUsd: number;
  /** Per-person burst limit: requests per hour. */
  perUserHourly: number;
  /** Price per million tokens by model, overriding the built-in table. */
  pricing?: Record<string, { inputPerMTok: number; outputPerMTok: number }>;
};
