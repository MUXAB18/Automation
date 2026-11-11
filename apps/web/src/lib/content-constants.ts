import type { AiTask } from "@automation/db";

/**
 * Plain values that client components need. `@automation/db` pulls in the database driver, so client components may
 * only import TYPES from it (a test enforces this); runtime values they need live here.
 */
export const CHANNELS = [
  "website",
  "linkedin",
  "facebook",
  "instagram",
  "x",
  "google_business",
  "email",
] as const;

export const TASK_LABEL: Record<AiTask, string> = {
  content_brief: "SEO content brief",
  blog_draft: "Blog draft",
  seo_titles: "SEO title suggestions",
  meta_descriptions: "Meta descriptions",
  social_captions: "Social captions",
  hashtags: "Hashtags",
  repurpose: "Repurpose content",
  seo_recommendations: "SEO recommendations",
  report_summary: "Report summary",
};
