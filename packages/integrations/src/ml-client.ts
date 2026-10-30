import { z } from "zod";

import type { FetchLike } from "./google-http";

const intentSchema = z.enum(["informational", "commercial", "transactional", "navigational", "local"]);

const analyzeResponseSchema = z.object({
  intents: z.array(z.object({ keyword: z.string(), intent: intentSchema, confidence: z.number() })),
  clusters: z.array(
    z.object({ label: z.string(), intent: intentSchema, size: z.number().int(), keywords: z.array(z.string()) }),
  ),
  model: z.object({
    version: z.string(),
    trained_at: z.string(),
    accuracy: z.number(),
    training_examples: z.number().int(),
  }),
});

export type KeywordAnalysis = z.infer<typeof analyzeResponseSchema>;
export type SearchIntent = z.infer<typeof intentSchema>;

export class MlServiceError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "MlServiceError";
  }
}

export type MlClientOptions = {
  baseUrl: string;
  token: string;
  fetch?: FetchLike;
  timeoutMs?: number;
};

/** Keywords per request; the Python service accepts at most 2000. */
export const ML_BATCH_SIZE = 1000;

/**
 * Client for the Python keyword service (services/ml). The worker calls it with a client's keywords;
 * the service holds no client data and the response is validated before anything trusts it.
 */
export function createMlClient(options: MlClientOptions) {
  const doFetch = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/+$/, "");

  async function analyzeKeywords(keywords: string[], similarityThreshold = 0.35): Promise<KeywordAnalysis> {
    const cleaned = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))];
    if (cleaned.length === 0) throw new MlServiceError("No keywords to analyze");
    if (cleaned.length > ML_BATCH_SIZE) {
      throw new MlServiceError(`Send at most ${ML_BATCH_SIZE} keywords per call so related ones stay clustered together`);
    }
    let response: Response;
    try {
      response = await doFetch(`${base}/v1/keywords/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${options.token}` },
        body: JSON.stringify({ keywords: cleaned, similarity_threshold: similarityThreshold }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      });
    } catch (error) {
      throw new MlServiceError(`ML service unreachable: ${error instanceof Error ? error.message : "unknown error"}`);
    }
    if (!response.ok) throw new MlServiceError(`ML service returned ${response.status}`, response.status);
    const parsed = analyzeResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new MlServiceError("ML service returned an unexpected response");
    return parsed.data;
  }

  async function health(): Promise<boolean> {
    try {
      const response = await doFetch(`${base}/health`, { signal: AbortSignal.timeout(5_000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  return { analyzeKeywords, health };
}

export type MlClient = ReturnType<typeof createMlClient>;
