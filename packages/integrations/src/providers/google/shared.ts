import { ProviderError, toProviderError } from "../../framework/errors";
import type { AdapterContext, NormalizedRecord, Page, PageRequest } from "../../framework/types";
import { GOOGLE_BACKFILL_DAYS, GOOGLE_OVERLAP_DAYS, type GoogleSettings } from "./config";
import { settingsSchema } from "./schemas";

export type Cursor = { s?: number; from?: string; q?: number };
export const encode = (c: Cursor) => JSON.stringify(c);
export const decode = (raw: string | null): Cursor => {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Cursor;
  } catch {
    return {};
  }
};

export const ymd = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (day: string, n: number) =>
  ymd(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000));
/** GA4 returns dates as YYYYMMDD. */
export const fromGa4Date = (v: string) =>
  /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : v;

export const settingsOf = (ctx: AdapterContext): GoogleSettings => {
  const parsed = settingsSchema.safeParse(ctx.settings ?? { sources: [] });
  return parsed.success ? parsed.data : { sources: [] };
};

/** Items fetchPage produces; normalize turns each into records. */
export type Item = { kind: string } & Record<string, unknown>;

/** First day to read for a source: continue from the stored day with an overlap, or backfill. */
export function startDay(dataThrough: string | null, today: string): string {
  return dataThrough
    ? addDays(dataThrough, -GOOGLE_OVERLAP_DAYS)
    : addDays(today, -GOOGLE_BACKFILL_DAYS);
}

/**
 * Run one selected property's call. A property this account cannot reach (or that no longer exists)
 * is reported as a problem on that property, so it never blocks the others.
 */
export async function perSource(
  request: PageRequest,
  ctx: AdapterContext,
  run: (
    source: GoogleSettings["sources"][number],
    cursor: Cursor,
  ) => Promise<{ items: Item[]; next?: Cursor }>,
): Promise<Page<unknown>> {
  const { sources } = settingsOf(ctx);
  const cursor = decode(request.cursor);
  const s = cursor.s ?? 0;
  const source = sources[s];
  if (!source) return { items: [], nextCursor: null };
  let result: { items: Item[]; next?: Cursor };
  try {
    result = await run(source, cursor);
  } catch (error) {
    const mapped = toProviderError(error);
    if (mapped.code !== "access_denied" && mapped.code !== "not_found") throw mapped;
    result = {
      items: [
        {
          kind: "problem",
          sourceKey: source.externalId,
          code: mapped.code,
          message: mapped.safeMessage,
        },
      ],
    };
  }
  const next = result.next ?? (s + 1 < sources.length ? { s: s + 1 } : null);
  return { items: result.items, nextCursor: next ? encode(next) : null };
}

export const invalid = (what: string) =>
  new ProviderError("invalid_response", `Google returned ${what} in an unexpected shape.`);

/** A metrics record: one row of a report with all its metric values. */
export function metricsRecord(args: {
  resource: string;
  sourceKey: string;
  kind: "ga4" | "search_console";
  set: string;
  day: string;
  dimensions: Record<string, string>;
  values: Record<string, number | null>;
  isFinal: boolean;
  mock?: boolean;
}): NormalizedRecord {
  const dimKey = Object.entries(args.dimensions)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("|");
  return {
    resource: "metrics",
    externalId: `${args.sourceKey}:${args.set}:${args.day}:${dimKey}`,
    occurredAt: `${args.day}T00:00:00.000Z`,
    source: args.mock ? "mock" : "live",
    data: {
      sourceKey: args.sourceKey,
      kind: args.kind,
      set: args.set,
      day: args.day,
      dimensions: args.dimensions,
      values: args.values,
      isFinal: args.isFinal,
    },
  };
}

export const problemRecord = (
  item: Item,
  kind: "ga4" | "search_console",
  mock = false,
): NormalizedRecord => ({
  resource: "source_problem",
  externalId: String(item.sourceKey),
  occurredAt: null,
  source: mock ? "mock" : "live",
  data: { sourceKey: item.sourceKey, kind, code: item.code, message: item.message },
});
