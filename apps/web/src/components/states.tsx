import Link from "next/link";
import { AlertTriangle, FlaskConical, Hammer, Inbox } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Nothing here yet. Say why and, when there is something real to do, offer it. */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: { label: string; href: string };
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-12 text-center",
        className,
      )}
    >
      <span className="mb-3 inline-flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="font-medium">{title}</p>
      {description ? (
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? (
        <Button asChild variant="outline" size="sm" className="mt-4">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      ) : null}
    </div>
  );
}

/** Something failed. Never shows internals; `digest` helps support find the server log. */
export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this. Try again, and if it keeps happening let an administrator know.",
  digest,
  onRetry,
}: {
  title?: string;
  description?: string;
  digest?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-12 text-center"
    >
      <span className="mb-3 inline-flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-5" aria-hidden />
      </span>
      <p className="font-medium">{title}</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      {digest ? <p className="mt-2 text-xs text-muted-foreground">Reference: {digest}</p> : null}
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** Marks a section whose provider-backed features are not built yet. */
export function DevelopmentNotice({ children }: { children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-info/30 bg-info/10 px-4 py-3 text-sm">
      <Hammer className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
      <p>
        <span className="font-medium">Under development.</span>{" "}
        <span className="text-muted-foreground">
          {children ??
            "This page reads your own database. Connecting live data from Google, social networks and other providers is not available yet."}
        </span>
      </p>
    </div>
  );
}

/** A row created by the development seed script (not synced from a provider). */
export function SampleBadge({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <Badge
      tone="info"
      className="gap-1"
      title="Created by the development seed script, not live provider data"
    >
      <FlaskConical className="size-3" aria-hidden />
      Sample
    </Badge>
  );
}

/** Page-level reminder that some rows are seed data. Render only when at least one row is sample. */
export function SampleBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm">
      <FlaskConical className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">Development sample data.</span> Rows marked{" "}
        <SampleBadge /> were created by the seed script. Nothing here comes from a connected
        provider.
      </p>
    </div>
  );
}
