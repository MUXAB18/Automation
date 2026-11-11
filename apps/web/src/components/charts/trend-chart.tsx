"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type ChartPoint = { day: string; [series: string]: number | string | null };
export type ChartSeries = { key: string; label: string; color: string };

const axis = { fontSize: 11, fill: "var(--muted-foreground)" };
const compact = (n: number) =>
  new Intl.NumberFormat("en-CA", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const shortDay = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/**
 * Line or bar chart over days, drawn only from the points it is given. A day without a reading is a gap in the line,
 * never a zero. Colours are theme tokens, so it follows light and dark mode.
 */
export function TrendChart({
  data,
  series,
  kind = "line",
  height = 240,
  label,
}: {
  data: ChartPoint[];
  series: ChartSeries[];
  kind?: "line" | "bar";
  height?: number;
  label: string;
}) {
  const common = { data, margin: { top: 8, right: 8, bottom: 0, left: 0 } };
  const shared = (
    <>
      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
      <XAxis
        dataKey="day"
        tickFormatter={shortDay}
        tick={axis}
        tickLine={false}
        axisLine={false}
        minTickGap={24}
      />
      <YAxis tickFormatter={compact} tick={axis} tickLine={false} axisLine={false} width={44} />
      <Tooltip
        labelFormatter={(d) => shortDay(String(d))}
        formatter={(v) =>
          typeof v === "number"
            ? v.toLocaleString("en-CA", { maximumFractionDigits: 1 })
            : String(v)
        }
        contentStyle={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          fontSize: 12,
        }}
      />
      {series.length > 1 ? <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} /> : null}
    </>
  );
  return (
    <div role="img" aria-label={label} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {kind === "bar" ? (
          <BarChart {...common}>
            {shared}
            {series.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={s.color}
                radius={[4, 4, 0, 0]}
              />
            ))}
          </BarChart>
        ) : (
          <LineChart {...common}>
            {shared}
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                connectNulls={false}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
