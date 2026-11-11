import Link from "next/link";
import { AlertTriangle, Clock, FlaskConical } from "lucide-react";
import type { Freshness } from "@automation/db";
import { Badge } from "@/components/ui/badge";
import { formatDay } from "@/lib/format";

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function ago(date: Date): string {
  const s = Math.round((date.getTime() - Date.now()) / 1000);
  const a = Math.abs(s);
  if (a < 60) return "just now";
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}

/** The data-freshness line for one source: what is stored, how old it is, and anything wrong. */
export function FreshnessBar({
  name,
  isMock,
  freshness,
  kind,
  accountHref,
}: {
  name: string;
  isMock: boolean;
  freshness: Freshness;
  kind: "ga4" | "gsc";
  accountHref?: string;
}) {
  // Search Console reports final data two to three days late; Analytics about a day.
  const normalLag = kind === "gsc" ? 4 : 3;
  const behind = freshness.lagDays !== null && freshness.lagDays > normalLag;
  const failed = freshness.lastRun?.status === "failed";
  return (
    <div className="mb-4 space-y-2 text-sm">
      {isMock ? (
        <p className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-2.5">
          <FlaskConical className="size-4 text-warning" aria-hidden />{" "}
          <span>
            <strong>Development mock.</strong> These numbers are made up and are not from Google.
          </span>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-muted-foreground">
        <span className="font-medium text-foreground">{name}</span>
        {freshness.hasData ? (
          <>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5" aria-hidden /> Data through{" "}
              {formatDay(new Date(`${freshness.dataThrough}T00:00:00Z`))} (
              {freshness.lagDays === 0
                ? "today"
                : `${freshness.lagDays} day${freshness.lagDays === 1 ? "" : "s"} ago`}
              )
            </span>
            {freshness.lastSyncedAt ? (
              <span>
                synced{" "}
                <time dateTime={freshness.lastSyncedAt.toISOString()}>
                  {ago(freshness.lastSyncedAt)}
                </time>
              </span>
            ) : null}
            {behind ? (
              <Badge tone="warning">Behind schedule</Badge>
            ) : (
              <Badge tone="success">Up to date</Badge>
            )}
          </>
        ) : (
          <Badge tone="neutral">Not synced yet</Badge>
        )}
        {failed ? <Badge tone="destructive">Last sync failed</Badge> : null}
        {accountHref ? (
          <Link href={accountHref} className="text-primary underline">
            Integration
          </Link>
        ) : null}
      </div>
      {freshness.problem ? (
        <p className="flex items-start gap-2 text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />{" "}
          {freshness.problem.message}
        </p>
      ) : null}
      {!freshness.hasData ? (
        <p className="text-muted-foreground">
          Selected, but nothing has been imported yet. Numbers appear only after a sync has finished
          successfully.
        </p>
      ) : null}
    </div>
  );
}
