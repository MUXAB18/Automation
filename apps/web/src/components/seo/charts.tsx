import { cn } from "@/lib/utils";

type Point = { x: string; y: number | null };

/**
 * A small server-rendered SVG line chart. Gaps (null) break the line instead of being drawn as zero.
 * `invert` puts small numbers at the top (ranking positions: 1 is best). A visually hidden table carries
 * the same numbers for screen readers.
 */
export function LineChart({
  points,
  label,
  invert = false,
  integerAxis = false,
  className,
}: {
  points: Point[];
  label: string;
  invert?: boolean;
  integerAxis?: boolean;
  className?: string;
}) {
  const W = 640;
  const H = 180;
  const pad = { l: 36, r: 12, t: 10, b: 24 };
  const values = points.map((p) => p.y).filter((v): v is number => v !== null);
  if (points.length === 0 || values.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">No readings in this period.</p>
    );
  }
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  if (!invert) lo = Math.min(lo, 0);
  const sx = (i: number) =>
    pad.l +
    (points.length === 1
      ? (W - pad.l - pad.r) / 2
      : (i / (points.length - 1)) * (W - pad.l - pad.r));
  const sy = (v: number) => {
    const t = (v - lo) / (hi - lo);
    return pad.t + (invert ? t : 1 - t) * (H - pad.t - pad.b);
  };
  const segments: string[] = [];
  let current = "";
  points.forEach((p, i) => {
    if (p.y === null) {
      if (current) segments.push(current);
      current = "";
    } else current += `${current ? "L" : "M"}${sx(i).toFixed(1)},${sy(p.y).toFixed(1)}`;
  });
  if (current) segments.push(current);
  const ticks = [lo, (lo + hi) / 2, hi].map((v) =>
    integerAxis ? Math.round(v) : Math.round(v * 10) / 10,
  );
  const fmt = (v: number) => (integerAxis ? String(Math.round(v)) : v.toFixed(1));

  return (
    <figure className={cn("w-full", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full">
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={pad.l}
              x2={W - pad.r}
              y1={sy(t)}
              y2={sy(t)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={pad.l - 6}
              y={sy(t) + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[10px]"
            >
              {t}
            </text>
          </g>
        ))}
        {segments.map((d) => (
          <path
            key={d}
            d={d}
            fill="none"
            className="stroke-primary"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {points.map((p, i) =>
          p.y === null ? null : (
            <circle
              key={p.x}
              cx={sx(i)}
              cy={sy(p.y)}
              r={points.length > 45 ? 0 : 2.5}
              className="fill-primary"
            />
          ),
        )}
        <text x={pad.l} y={H - 6} className="fill-muted-foreground text-[10px]">
          {points[0]!.x}
        </text>
        <text
          x={W - pad.r}
          y={H - 6}
          textAnchor="end"
          className="fill-muted-foreground text-[10px]"
        >
          {points.at(-1)!.x}
        </text>
      </svg>
      <figcaption className="sr-only">{label}</figcaption>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th>Day</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.x}>
              <td>{p.x}</td>
              <td>{p.y === null ? "no reading" : fmt(p.y)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Tiny trend line for a table cell. Lower position = better, so the line is inverted. */
export function Sparkline({
  series,
  label,
}: {
  series: { day: string; position: number | null }[];
  label: string;
}) {
  const values = series.map((s) => s.position).filter((v): v is number => v !== null);
  if (values.length < 2) return <span className="text-xs text-muted-foreground">—</span>;
  const W = 80;
  const H = 24;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const d = series
    .map((s, i) =>
      s.position === null
        ? null
        : `${(i / Math.max(series.length - 1, 1)) * W},${2 + ((s.position - lo) / span) * (H - 4)}`,
    )
    .filter(Boolean)
    .map((pt, i) => `${i ? "L" : "M"}${pt}`)
    .join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-6 w-20">
      <path d={d} fill="none" className="stroke-primary" strokeWidth={1.5} />
    </svg>
  );
}
