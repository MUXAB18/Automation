import { ProviderError, errorFromStatus } from "../framework/errors";

/**
 * Real AI provider adapters. They implement the provider-independent contract of `@automation/db`
 * (`AiProvider`) structurally, so the platform never imports a vendor SDK: only `fetch`.
 * Credentials come from the environment and never leave this file; only a safe message is thrown.
 */

export type AiProviderRequestLike = {
  model: string;
  system: string;
  prompt: string;
  maxOutputTokens: number;
  signal?: AbortSignal;
};
export type AiProviderResultLike = { text: string; inputTokens?: number; outputTokens?: number };
export type AiProviderLike = {
  readonly key: string;
  generate(
    request: AiProviderRequestLike & { task: string; meta: Record<string, unknown> },
  ): Promise<AiProviderResultLike>;
};

export type AiAdapterConfig =
  | { provider: "anthropic"; apiKey: string; baseUrl?: string }
  /** OpenAI, OpenRouter, Azure-style gateways and local servers (Ollama, vLLM) that speak the chat-completions protocol. */
  | { provider: "openai_compatible"; apiKey?: string; baseUrl: string };

async function post(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
) {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError")
      throw new ProviderError("timeout", "The AI provider took too long to answer.");
    throw new ProviderError("network", "The AI provider could not be reached.");
  }
  if (!res.ok)
    throw errorFromStatus(res.status, Number(res.headers.get("retry-after")) || undefined);
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    throw new ProviderError(
      "invalid_response",
      "The AI provider returned data in an unexpected shape.",
    );
  }
}

function anthropic(cfg: Extract<AiAdapterConfig, { provider: "anthropic" }>): AiProviderLike {
  return {
    key: "anthropic",
    async generate(req) {
      const json = await post(
        `${cfg.baseUrl ?? "https://api.anthropic.com"}/v1/messages`,
        { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" },
        {
          model: req.model,
          max_tokens: req.maxOutputTokens,
          system: req.system,
          messages: [{ role: "user", content: req.prompt }],
        },
        req.signal,
      );
      const content = json.content as { type: string; text?: string }[] | undefined;
      const text = content
        ?.filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("");
      if (!text) throw new ProviderError("invalid_response", "The AI provider returned no text.");
      const usage = json.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      return { text, inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens };
    },
  };
}

function openaiCompatible(
  cfg: Extract<AiAdapterConfig, { provider: "openai_compatible" }>,
): AiProviderLike {
  return {
    key: "openai_compatible",
    async generate(req) {
      const json = await post(
        `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`,
        cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {},
        {
          model: req.model,
          max_tokens: req.maxOutputTokens,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.prompt },
          ],
        },
        req.signal,
      );
      const choices = json.choices as { message?: { content?: string } }[] | undefined;
      const text = choices?.[0]?.message?.content;
      if (!text) throw new ProviderError("invalid_response", "The AI provider returned no text.");
      const usage = json.usage as
        { prompt_tokens?: number; completion_tokens?: number } | undefined;
      return { text, inputTokens: usage?.prompt_tokens, outputTokens: usage?.completion_tokens };
    },
  };
}

export function createAiProvider(cfg: AiAdapterConfig): AiProviderLike {
  return cfg.provider === "anthropic" ? anthropic(cfg) : openaiCompatible(cfg);
}
