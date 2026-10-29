/** Query-string helpers. URL values are untrusted: always narrow them before use. */
export type RawParams = Record<string, string | string[] | undefined>;

export const str = (v: string | string[] | undefined, max = 100): string | undefined => {
  const value = Array.isArray(v) ? v[0] : v;
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
};

export const page = (v: string | string[] | undefined): number => {
  const n = Number.parseInt(str(v, 6) ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

export const flag = (v: string | string[] | undefined): boolean => str(v) === "1";

/** Only values from an allow-list; anything else is ignored rather than passed to a query. */
export const oneOf = <T extends string>(
  v: string | string[] | undefined,
  allowed: readonly T[],
): T | undefined => {
  const value = str(v);
  return allowed.find((a) => a === value);
};

/** Flatten for the Pagination component. */
export const flat = (p: RawParams): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries(p).map(([k, v]) => [k, str(v)]));
