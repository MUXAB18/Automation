import type { AiProvider, AiProviderRequest, AiProviderResult } from "./provider";
import { AiProviderError } from "./provider";

/**
 * A deterministic stand-in for a real model: needs no API key and contacts no one. It returns valid, clearly
 * labelled placeholder JSON for every task, so the whole pipeline can be developed and tested offline.
 * `failWith` lets tests simulate provider failures.
 */
export function createMockAiProvider(
  opts: { failWith?: (call: number) => Error | null; raw?: (task: string) => string | null } = {},
): AiProvider & { calls: AiProviderRequest[] } {
  const calls: AiProviderRequest[] = [];
  return {
    key: "mock",
    calls,
    async generate(req: AiProviderRequest): Promise<AiProviderResult> {
      calls.push(req);
      const failure = opts.failWith?.(calls.length);
      if (failure) throw failure;
      const raw = opts.raw?.(req.task);
      const text = raw ?? JSON.stringify(mockOutput(req.task, req.meta));
      return {
        text,
        inputTokens: Math.ceil((req.system.length + req.prompt.length) / 4),
        outputTokens: Math.ceil(text.length / 4),
      };
    },
  };
}

const s = (v: unknown, fallback: string) => (typeof v === "string" && v ? v : fallback);

export function mockOutput(task: string, meta: Record<string, unknown>): unknown {
  const topic = s(meta.topic ?? meta.focus ?? meta.sourceTitle, "the topic");
  const kw = s(meta.primaryKeyword, topic);
  const word = kw.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 30);
  const tag = `#${word.length >= 2 ? word : `${word}seo`}`;
  switch (task) {
    case "content_brief":
      return {
        title: `Guide: ${topic}`,
        searchIntent: "Informational: the reader wants to understand the topic before deciding.",
        outline: [
          { heading: "Introduction", points: [`Why ${topic} matters`] },
          { heading: `What ${kw} means`, points: ["Definition", "Examples"] },
        ],
        keyPoints: [`Mention ${kw} naturally`],
        faqs: [{ question: `What is ${kw}?`, answerOutline: "Short definition." }],
        claimsToVerify: ["Placeholder (mock provider): no real claims were made."],
      };
    case "blog_draft":
      return {
        title: `Mock draft: ${topic}`,
        metaDescription: `A mock draft about ${topic}.`,
        body: `# ${topic}\n\nThis is mock-provider placeholder text about ${kw}. Replace it with a real draft.`,
        claimsToVerify: ["Placeholder (mock provider)."],
      };
    case "seo_titles":
      return {
        suggestions: [
          { title: `${kw}: a practical guide`, reason: "Leads with the keyword." },
          { title: `Everything about ${kw}`, reason: "Broad match." },
        ],
        claimsToVerify: [],
      };
    case "meta_descriptions":
      return {
        suggestions: [
          { text: `Learn about ${kw}. Mock description.`, reason: "Short and direct." },
        ],
        claimsToVerify: [],
      };
    case "social_captions":
      return {
        captions: [
          { text: `Mock caption about ${topic}.`, hashtags: [tag] },
          { text: `Another mock caption for ${topic}.`, hashtags: [tag] },
        ],
        claimsToVerify: [],
      };
    case "hashtags":
      return { hashtags: [tag, "#marketing", "#seo"] };
    case "repurpose":
      return {
        title: s(meta.sourceTitle, "Repurposed"),
        body: `Mock repurposed text for ${s(meta.targetChannel, "the channel")}.`,
        hashtags: [tag],
        claimsToVerify: [],
      };
    case "seo_recommendations":
      return {
        recommendations: [
          {
            title: `Improve internal links for ${topic}`,
            rationale: "Mock recommendation from the development provider.",
            priority: "medium",
            effort: "small",
            evidence: [],
          },
        ],
        caveats: ["Mock provider: not based on real analysis."],
      };
    case "report_summary":
      return {
        summary: "Mock summary. No real analysis was performed.",
        highlights: [],
        risks: [],
        nextSteps: [],
        figuresUsed: [],
      };
    default:
      throw new AiProviderError("Unknown task");
  }
}
