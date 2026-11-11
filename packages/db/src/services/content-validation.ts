import type { Channel } from "../ai/templates";

/**
 * What each channel accepts. These are conservative, documented limits used to stop an obviously unpublishable
 * post before it is queued; the provider remains the final judge and its answer is recorded either way.
 */
type Rule = {
  maxChars: number;
  maxHashtags: number;
  mediaRequired: boolean;
  maxImages: number;
  maxVideos: number;
  allowMixed: boolean;
  directPlatforms: string[];
};

export const CHANNEL_RULES: Record<Channel, Rule> = {
  x: {
    maxChars: 280,
    maxHashtags: 10,
    mediaRequired: false,
    maxImages: 4,
    maxVideos: 1,
    allowMixed: false,
    directPlatforms: ["twitter", "x"],
  },
  linkedin: {
    maxChars: 3000,
    maxHashtags: 30,
    mediaRequired: false,
    maxImages: 9,
    maxVideos: 1,
    allowMixed: false,
    directPlatforms: ["linkedin"],
  },
  facebook: {
    maxChars: 5000,
    maxHashtags: 30,
    mediaRequired: false,
    maxImages: 10,
    maxVideos: 1,
    allowMixed: false,
    directPlatforms: ["facebook"],
  },
  instagram: {
    maxChars: 2200,
    maxHashtags: 30,
    mediaRequired: true,
    maxImages: 10,
    maxVideos: 1,
    allowMixed: true,
    directPlatforms: ["instagram"],
  },
  google_business: {
    maxChars: 1500,
    maxHashtags: 0,
    mediaRequired: false,
    maxImages: 1,
    maxVideos: 0,
    allowMixed: false,
    directPlatforms: ["google", "gmb", "googlemybusiness", "google_business"],
  },
  website: {
    maxChars: 100_000,
    maxHashtags: 0,
    mediaRequired: false,
    maxImages: 50,
    maxVideos: 5,
    allowMixed: true,
    directPlatforms: [],
  },
  email: {
    maxChars: 100_000,
    maxHashtags: 0,
    mediaRequired: false,
    maxImages: 50,
    maxVideos: 0,
    allowMixed: true,
    directPlatforms: [],
  },
};

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const VIDEO_TYPES = ["video/mp4", "video/quicktime"];
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

export type MediaFacts = {
  fileName: string;
  mimeType: string;
  sizeBytes: number | bigint;
  altText?: string | null;
};
export type ValidationResult = { errors: string[]; warnings: string[] };

/** The text as it will be posted: caption, then hashtags. */
export const postText = (body: string, hashtags: string[]) =>
  hashtags.length ? `${body.trim()}\n\n${hashtags.join(" ")}` : body.trim();

export function validateContent(
  channel: Channel,
  input: { body: string; hashtags: string[]; media: MediaFacts[]; bannedTerms?: string[] },
): ValidationResult {
  const rule = CHANNEL_RULES[channel];
  const errors: string[] = [];
  const warnings: string[] = [];
  const text = postText(input.body, input.hashtags);
  if (!input.body.trim()) errors.push("There is no text to publish.");
  if (text.length > rule.maxChars)
    errors.push(
      `The text is ${text.length} characters; ${channel.replace("_", " ")} allows ${rule.maxChars}.`,
    );
  if (input.hashtags.length > rule.maxHashtags && rule.maxHashtags > 0)
    errors.push(`${input.hashtags.length} hashtags; the limit is ${rule.maxHashtags}.`);
  if (rule.maxHashtags === 0 && input.hashtags.length > 0)
    warnings.push("Hashtags are not used on this channel.");

  const images = input.media.filter((m) => IMAGE_TYPES.includes(m.mimeType));
  const videos = input.media.filter((m) => VIDEO_TYPES.includes(m.mimeType));
  for (const m of input.media) {
    if (!IMAGE_TYPES.includes(m.mimeType) && !VIDEO_TYPES.includes(m.mimeType))
      errors.push(`"${m.fileName}" is not a supported image or video.`);
    else if (IMAGE_TYPES.includes(m.mimeType) && Number(m.sizeBytes) > MAX_IMAGE_BYTES)
      errors.push(`"${m.fileName}" is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
    else if (VIDEO_TYPES.includes(m.mimeType) && Number(m.sizeBytes) > MAX_VIDEO_BYTES)
      errors.push(`"${m.fileName}" is larger than ${MAX_VIDEO_BYTES / 1024 / 1024} MB.`);
    if (IMAGE_TYPES.includes(m.mimeType) && !m.altText?.trim())
      warnings.push(`"${m.fileName}" has no alt text.`);
  }
  if (rule.mediaRequired && input.media.length === 0)
    errors.push("This channel needs at least one image or video.");
  if (images.length > rule.maxImages)
    errors.push(`${images.length} images; the limit is ${rule.maxImages}.`);
  if (videos.length > rule.maxVideos)
    errors.push(
      videos.length > 0 && rule.maxVideos === 0
        ? "This channel does not take video."
        : `${videos.length} videos; the limit is ${rule.maxVideos}.`,
    );
  if (!rule.allowMixed && images.length > 0 && videos.length > 0)
    errors.push("Use images or a video, not both.");

  const lower = text.toLowerCase();
  for (const term of input.bannedTerms ?? [])
    if (term && lower.includes(term.toLowerCase()))
      errors.push(`Contains a term the brand guideline bans: "${term}".`);
  return { errors, warnings };
}

/** The social platform names that count as this channel when matching a provider account. */
export const directPlatformsFor = (channel: Channel) => CHANNEL_RULES[channel].directPlatforms;
