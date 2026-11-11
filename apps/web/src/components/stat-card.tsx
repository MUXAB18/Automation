import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

const CHIP = {
  default: "bg-primary-soft text-primary",
  success: "bg-success/15 text-success",
  warning: "bg-warning/20 text-warning",
  destructive: "bg-destructive/15 text-destructive",
  info: "bg-info/15 text-info",
} as const;

const PILL = {
  success: "bg-success/15 text-success",
  destructive: "bg-destructive/15 text-destructive",
  warning: "bg-warning/20 text-warning",
  neutral: "bg-muted text-muted-foreground",
} as const;

/**
 * One headline number. `highlight` fills the card with the brand gradient (use for the single most
 * important figure). `pill` is a small factual status in the corner (never an invented trend).
 */
export function StatCard({
  label,
  value,
  helper,
  icon: Icon,
  tone = "default",
  href,
  highlight = false,
  pill,
}: {
  label: string;
  value: number | string;
  helper?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  tone?: keyof typeof CHIP;
  href?: string;
  highlight?: boolean;
  pill?: { label: string; tone: keyof typeof PILL };
}) {
  const body = (
    <div
      className={cn(
        "flex h-full min-h-44 flex-col justify-between rounded-[1.375rem] p-6 transition-all",
        highlight
          ? "bg-gradient-to-br from-brand-from to-brand-to text-white shadow-xl shadow-primary/30"
          : "border border-border/60 bg-card shadow-card",
        href && !highlight && "group-hover:-translate-y-0.5 group-hover:shadow-lg",
        href && highlight && "group-hover:-translate-y-0.5",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={cn(
            "inline-flex size-12 items-center justify-center rounded-2xl",
            highlight ? "bg-white/20 text-white" : CHIP[tone],
          )}
        >
          <Icon className="size-5" aria-hidden />
        </span>
        {pill ? (
          <span
            className={cn(
              "rounded-lg px-2.5 py-1 text-xs font-semibold",
              highlight ? "bg-white/20 text-white" : PILL[pill.tone],
            )}
          >
            {pill.label}
          </span>
        ) : null}
      </div>
      <div>
        <p
          className={cn(
            "text-sm font-medium",
            highlight ? "text-white/85" : "text-muted-foreground",
          )}
        >
          {label}
        </p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <p className="text-[2rem] font-bold leading-tight tracking-tight tabular-nums">{value}</p>
          {helper ? (
            <p
              className={cn(
                "text-xs leading-snug",
                highlight ? "text-white/75" : "text-muted-foreground",
              )}
            >
              {helper}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
  if (!href) return body;
  return (
    <Link
      href={href}
      className="group relative block h-full rounded-[1.375rem] focus-visible:outline-2 focus-visible:outline-ring"
    >
      {body}
      <ArrowUpRight
        className={cn(
          "absolute right-4 top-[4.6rem] size-4 opacity-0 transition-opacity group-hover:opacity-100",
          highlight ? "text-white/80" : "text-muted-foreground",
        )}
        aria-hidden
      />
      <span className="sr-only">Open {label}</span>
    </Link>
  );
}
