import type { Metric } from "@automation/db";
import { cn } from "@/lib/utils";

export function formatMetric(m: Metric): string {
  if (m.value === null) return m.state === "no_source" ? "Not connected" : "No data";
  if (m.unit === "percent") return `${m.value.toFixed(1)}%`;
  if (m.unit === "position") return m.value.toFixed(1);
  if (m.unit === "usd") return `$${m.value.toFixed(m.value < 1 ? 4 : 2)}`;
  return m.value.toLocaleString("en-CA", { maximumFractionDigits: 0 });
}

/**
 * One metric with its honest state. A missing figure shows "No data" or "Not connected" and the reason, never a zero.
 * The change is against the previous period of the same length, and only when both periods have data.
 */
export function MetricTile({ m, lowerIsBetter = false }: { m: Metric; lowerIsBetter?: boolean }) {
  const has = m.value !== null;
  const good = m.changePct === null ? null : lowerIsBetter ? m.changePct < 0 : m.changePct > 0;
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <p className="text-sm text-muted-foreground">{m.label}</p>
      <p
        className={cn(
          "mt-2 text-2xl font-bold tabular-nums tracking-tight",
          !has && "text-base font-medium text-muted-foreground",
        )}
      >
        {formatMetric(m)}
      </p>
      {m.changePct !== null ? (
        <p
          className={cn(
            "mt-1 text-xs font-medium tabular-nums",
            good ? "text-success" : good === false ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {m.changePct >= 0 ? "▲" : "▼"} {Math.abs(m.changePct).toFixed(1)}% vs previous period
        </p>
      ) : has && m.previous === null ? (
        <p className="mt-1 text-xs text-muted-foreground">No earlier period to compare</p>
      ) : null}
      {m.note ? (
        <p
          className={cn(
            "mt-1 text-xs",
            m.state === "partial" ? "text-warning" : "text-muted-foreground",
          )}
        >
          {m.note}
        </p>
      ) : null}
    </div>
  );
}
