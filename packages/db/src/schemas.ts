import { z } from "zod";
import { ValidationError } from "./errors";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and dashes");

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** "https://SARJWorldwide.ca/path" -> "sarjworldwide.ca" */
export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "");
}

export const domainSchema = z
  .string()
  .transform(normalizeDomain)
  .pipe(z.string().regex(HOSTNAME, "Enter a valid domain, e.g. example.com"));

// ---- Shared field helpers --------------------------------------------------------------------

const optionalText = (max: number) =>
  z.preprocess(
    emptyToUndefined,
    z.string().trim().max(max, `Keep this under ${max} characters`).optional(),
  );

/** Newline- or comma-separated text (or an array) -> trimmed, de-duplicated list. */
const textList = (opts: {
  maxItems: number;
  maxLength: number;
  lowercase?: boolean;
  label: string;
  /** What splits pasted text into items (default: new lines and commas). */
  separator?: RegExp;
}) =>
  z
    .preprocess(
      (value) => {
        const raw = Array.isArray(value)
          ? value
          : typeof value === "string"
            ? value.split(opts.separator ?? /[\n,]/)
            : [];
        const seen = new Set<string>();
        const out: string[] = [];
        for (const item of raw) {
          if (typeof item !== "string") continue;
          const text = item.trim().replace(/\s+/g, " ");
          const key = text.toLowerCase();
          if (!text || seen.has(key)) continue;
          seen.add(key);
          out.push(opts.lowercase ? key : text);
        }
        return out;
      },
      z
        .array(
          z
            .string()
            .min(2, `${opts.label} must be at least 2 characters`)
            .max(opts.maxLength, `${opts.label} must be under ${opts.maxLength} characters`),
        )
        .max(opts.maxItems, `Add at most ${opts.maxItems} ${opts.label.toLowerCase()}s`),
    )
    .default([]);

const TIME_ZONES = new Set<string>([...Intl.supportedValuesOf("timeZone"), "UTC"]);
export const isTimeZone = (value: string) => TIME_ZONES.has(value);
export const listTimeZones = (): string[] => [...TIME_ZONES].sort();

export const LOCALES = ["en-CA", "fr-CA", "en-US", "en-GB"] as const;

const checkbox = z.preprocess(
  (v) => v === true || v === "on" || v === "true" || v === "1",
  z.boolean(),
);

export const clientPreferencesSchema = z.object({
  /** How the fortnightly report reaches the client. */
  reportDelivery: z.enum(["email", "download"]).default("email"),
  /** Preferred weekday for delivery, 1 = Monday ... 7 = Sunday. */
  reportWeekday: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(7).optional()),
  /** Send the client a short weekly summary between reports. */
  weeklySummary: checkbox.default(false),
});
export type ClientPreferences = z.output<typeof clientPreferencesSchema>;

const clientFields = {
  name: z.string().trim().min(1, "Name is required").max(120),
  industry: optionalText(120),
  goals: optionalText(4000),
  // Places contain commas ("Ottawa, ON"), so they are separated by new lines or semicolons only.
  targetLocations: textList({
    maxItems: 25,
    maxLength: 100,
    label: "Location",
    separator: /[\n;]/,
  }),
  timezone: z.string().trim().refine(isTimeZone, "Choose a valid time zone").default("UTC"),
  locale: z.enum(LOCALES).default("en-CA"),
  reportEmail: z.preprocess(emptyToUndefined, z.email("Enter a valid email").optional()),
  reportIntervalDays: z.coerce
    .number()
    .int("Use a whole number of days")
    .min(1, "At least 1 day")
    .max(365, "At most 365 days")
    .default(15),
  preferences: clientPreferencesSchema.default({ reportDelivery: "email", weeklySummary: false }),
};

export const createClientSchema = z.object({
  ...clientFields,
  /** Required only when the actor can create clients in more than one agency. */
  agencyId: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  slug: z.preprocess(emptyToUndefined, slugSchema.optional()),
  primaryDomain: z.preprocess(emptyToUndefined, domainSchema.optional()),
  accountOwnerId: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
});

export const updateClientSchema = z.object({
  ...clientFields,
  slug: slugSchema,
});

export const brandGuidelineSchema = z.object({
  toneOfVoice: optionalText(1000),
  audience: optionalText(1000),
  styleNotes: optionalText(4000),
  dos: textList({ maxItems: 30, maxLength: 200, label: "Guideline" }),
  donts: textList({ maxItems: 30, maxLength: 200, label: "Guideline" }),
  bannedTerms: textList({ maxItems: 50, maxLength: 80, label: "Term" }),
});
export type BrandGuidelineInput = z.input<typeof brandGuidelineSchema>;

// ---- Projects -----------------------------------------------------------------------------------

export const PROJECT_KINDS = ["seo", "social", "content", "general"] as const;
export const PROJECT_STATUSES = ["active", "paused", "completed", "archived"] as const;
export const SOCIAL_CHANNELS = [
  "linkedin",
  "facebook",
  "instagram",
  "x",
  "google_business",
] as const;

const dateOnly = z.preprocess(
  emptyToUndefined,
  z.iso
    .date("Use the format YYYY-MM-DD")
    .transform((d) => new Date(`${d}T00:00:00.000Z`))
    .optional(),
);

export const seoTargetsSchema = z.object({
  websiteId: z.string().min(1, "Choose the website this project optimises"),
  targetCountry: z
    .string()
    .trim()
    .length(2, "Use a 2-letter country code, e.g. CA")
    .transform((v) => v.toUpperCase())
    .default("CA"),
  targetLanguage: z
    .string()
    .trim()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/, "Use a language code like en or fr-CA")
    .default("en"),
  keywords: textList({ maxItems: 100, maxLength: 80, lowercase: true, label: "Keyword" }),
  organicSessionsGoal: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  ),
  topTenKeywordsGoal: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(10_000).optional(),
  ),
});
export type SeoTargets = z.output<typeof seoTargetsSchema>;

export const socialRequirementsSchema = z.object({
  channels: z
    .preprocess(
      (v) => (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : []),
      z.array(z.enum(SOCIAL_CHANNELS)),
    )
    .pipe(z.array(z.enum(SOCIAL_CHANNELS)).min(1, "Choose at least one channel")),
  postsPerWeek: z.coerce
    .number()
    .int("Use a whole number")
    .min(1, "At least 1 post a week")
    .max(50, "At most 50 posts a week")
    .default(3),
  requirements: optionalText(2000),
});
export type SocialRequirements = z.output<typeof socialRequirementsSchema>;

const projectFields = {
  name: z.string().trim().min(1, "Name is required").max(120),
  kind: z.enum(PROJECT_KINDS).default("general"),
  status: z.enum(PROJECT_STATUSES).default("active"),
  description: optionalText(2000),
  goals: optionalText(4000),
  startsOn: dateOnly,
  endsOn: dateOnly,
  /** People assigned to the project (user ids). */
  memberIds: z
    .preprocess(
      (v) => (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : []),
      z.array(z.string().min(1)).max(50, "At most 50 people"),
    )
    .default([]),
  seo: seoTargetsSchema.optional(),
  social: socialRequirementsSchema.optional(),
};

type ProjectShape = {
  kind?: string;
  startsOn?: Date;
  endsOn?: Date;
  seo?: unknown;
  social?: unknown;
};
function checkProject(value: ProjectShape, ctx: z.RefinementCtx) {
  if (value.startsOn && value.endsOn && value.endsOn < value.startsOn) {
    ctx.addIssue({
      code: "custom",
      path: ["endsOn"],
      message: "The end date must be on or after the start date",
    });
  }
  if (value.kind === "seo" && !value.seo) {
    ctx.addIssue({
      code: "custom",
      path: ["seo.websiteId"],
      message: "SEO projects need SEO targets",
    });
  }
  if (value.kind === "social" && !value.social) {
    ctx.addIssue({
      code: "custom",
      path: ["social.channels"],
      message: "Social projects need social requirements",
    });
  }
}

export const createProjectSchema = z
  .object({ clientId: z.string().min(1), ...projectFields })
  .superRefine(checkProject);
export const updateProjectSchema = z.object(projectFields).superRefine(checkProject);
export type CreateProjectInput = z.input<typeof createProjectSchema>;
export type UpdateProjectInput = z.input<typeof updateProjectSchema>;

export const addWebsiteSchema = z.object({
  domain: domainSchema,
  isPrimary: z.coerce.boolean().default(false),
});

export const clientStatusSchema = z.enum(["active", "paused", "archived"]);

export type CreateClientInput = z.input<typeof createClientSchema>;
export type UpdateClientInput = z.input<typeof updateClientSchema>;
export type AddWebsiteInput = z.input<typeof addWebsiteSchema>;

/** Parse with a schema, throwing ValidationError with per-field messages. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  throw new ValidationError(fieldErrors);
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug.length >= 2 ? slug : `client-${slug || "x"}`;
}
