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

const clientFields = {
  name: z.string().trim().min(1, "Name is required").max(120),
  reportEmail: z.preprocess(emptyToUndefined, z.email("Enter a valid email").optional()),
  reportIntervalDays: z.coerce.number().int().min(1).max(365).default(15),
};

export const createClientSchema = z.object({
  ...clientFields,
  slug: z.preprocess(emptyToUndefined, slugSchema.optional()),
  primaryDomain: z.preprocess(emptyToUndefined, domainSchema.optional()),
});

export const updateClientSchema = z.object({
  ...clientFields,
  slug: slugSchema,
});

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
