/** Errors for a field and anything nested under it ("seo.keywords" also matches "seo.keywords.2"). */
export function errorsFor(
  fieldErrors: Record<string, string[]> | undefined,
  name: string,
): string | undefined {
  if (!fieldErrors) return undefined;
  const messages = Object.entries(fieldErrors)
    .filter(([key]) => key === name || key.startsWith(`${name}.`))
    .flatMap(([, list]) => list);
  return messages.length ? [...new Set(messages)].join(" ") : undefined;
}
