import type { AiTask } from "@automation/db";
import { CHANNELS } from "@/lib/content-constants";

export type Field = {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "checkbox" | "select" | "date" | "list";
  options?: readonly string[];
  required?: boolean;
  hint?: string;
  defaultValue?: string | number | boolean;
};

const topic: Field = { name: "topic", label: "Topic", type: "text", required: true };
const keywords: Field = {
  name: "keywords",
  label: "Keywords",
  type: "list",
  hint: "Separate with commas.",
};
const primary: Field = {
  name: "primaryKeyword",
  label: "Primary keyword",
  type: "text",
  required: true,
};
const audience: Field = { name: "audience", label: "Audience", type: "text" };
const tone: Field = {
  name: "tone",
  label: "Tone (optional)",
  type: "text",
  hint: "Leave empty to follow the brand guideline.",
};
const notes: Field = { name: "notes", label: "Extra notes", type: "textarea" };
const channel = (def: string): Field => ({
  name: "channel",
  label: "Channel",
  type: "select",
  options: CHANNELS,
  defaultValue: def,
});

export const TASK_FIELDS: Record<AiTask, Field[]> = {
  content_brief: [topic, primary, keywords, audience, channel("website"), notes],
  blog_draft: [
    topic,
    { ...primary, required: false },
    keywords,
    audience,
    tone,
    { name: "outline", label: "Outline (optional)", type: "textarea" },
    { name: "wordCount", label: "Target length (words)", type: "number", defaultValue: 800 },
    notes,
  ],
  seo_titles: [
    topic,
    primary,
    keywords,
    { name: "count", label: "How many", type: "number", defaultValue: 5 },
    notes,
  ],
  meta_descriptions: [
    topic,
    primary,
    keywords,
    { name: "count", label: "How many", type: "number", defaultValue: 3 },
    notes,
  ],
  social_captions: [
    topic,
    channel("linkedin"),
    tone,
    { name: "count", label: "How many", type: "number", defaultValue: 3 },
    notes,
  ],
  hashtags: [
    topic,
    channel("instagram"),
    { name: "count", label: "How many", type: "number", defaultValue: 10 },
  ],
  repurpose: [
    { name: "sourceContentItemId", label: "Content to repurpose", type: "select", required: true },
    {
      name: "targetChannel",
      label: "Rewrite for",
      type: "select",
      options: CHANNELS,
      defaultValue: "linkedin",
    },
    tone,
    notes,
  ],
  seo_recommendations: [
    { name: "focus", label: "What to look at", type: "text", required: true },
    {
      name: "includeOpenSeoIssues",
      label: "Include this client's open SEO issues",
      type: "checkbox",
      defaultValue: true,
    },
    notes,
  ],
  report_summary: [
    { name: "periodStart", label: "From", type: "date", required: true },
    { name: "periodEnd", label: "To", type: "date", required: true },
    {
      name: "includeSyncedFigures",
      label: "Use synced analytics figures",
      type: "checkbox",
      defaultValue: true,
    },
    notes,
  ],
};

/** Form fields -> the task's request. The service validates everything again. */
export function taskInput(task: AiTask, formData: FormData) {
  const input: Record<string, unknown> = {};
  for (const f of TASK_FIELDS[task]) {
    const raw = formData.get(f.name);
    if (f.type === "checkbox") input[f.name] = raw === "on";
    else if (f.type === "list")
      input[f.name] = String(raw ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    else if (typeof raw === "string" && raw.trim() !== "") input[f.name] = raw;
  }
  return input;
}
