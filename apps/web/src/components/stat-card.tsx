import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const TONES = {
  default: "bg-primary-soft text-primary",
  success: "bg-success/15 text-success",
  warning: "bg-warning/20 text-warning",
  destructive: "bg-destructive/15 text-destructive",
  info: "bg-info/15 text-info",
} as const;

/** A single headline number with context. Links to the page that explains it. */
export function StatCard({
  label,
  value,
  helper,
  icon: Icon,
  tone = "default",
  href,
}: {
  label: string;
  value: number | string;
  helper?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  tone?: keyof typeof TONES;
  href?: string;
}) {
  const body = (
    <Card className={cn("h-full transition-shadow", href && "hover:shadow-md")}>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{label}</CardTitle>
        <span
          className={cn("inline-flex size-8 items-center justify-center rounded-lg", TONES[tone])}
        >
          <Icon className="size-4" aria-hidden />
        </span>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
        {helper ? <p className="mt-1 text-xs text-muted-foreground">{helper}</p> : null}
      </CardContent>
    </Card>
  );
  if (!href) return body;
  return (
    <Link
      href={href}
      className="group relative block rounded-xl focus-visible:outline-2 focus-visible:outline-ring"
    >
      {body}
      <ArrowUpRight
        className="absolute right-3 top-14 size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden
      />
      <span className="sr-only">Open {label}</span>
    </Link>
  );
}
