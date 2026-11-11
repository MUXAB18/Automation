/**
 * Date ranges for the analytics dashboards. The newest selectable day is YESTERDAY (UTC): today is
 * incomplete in both Google products. Presets are inclusive day counts ending yesterday.
 */
export const PRESETS = { "7d": 7, "28d": 28, "90d": 90 } as const;
export type Preset = keyof typeof PRESETS;

export type ResolvedRange = { from: string; to: string; preset: Preset | "custom"; days: number };

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const valid = (v: string | undefined): v is string =>
  !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export function resolveRange(
  params: { range?: string; from?: string; to?: string },
  now = Date.now(),
): ResolvedRange {
  const yesterday = Math.floor(now / DAY) * DAY - DAY;
  if (valid(params.from) && valid(params.to)) {
    let from = Date.parse(params.from);
    let to = Math.min(Date.parse(params.to), yesterday);
    if (from > to) [from, to] = [to, from];
    // Cap at 400 days (the read model's limit) by moving the start forward.
    from = Math.max(from, to - 399 * DAY);
    return { from: iso(from), to: iso(to), preset: "custom", days: (to - from) / DAY + 1 };
  }
  const preset: Preset = params.range && params.range in PRESETS ? (params.range as Preset) : "28d";
  const days = PRESETS[preset];
  return { from: iso(yesterday - (days - 1) * DAY), to: iso(yesterday), preset, days };
}
