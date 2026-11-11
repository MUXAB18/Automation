import { Badge } from "@/components/ui/badge";

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function ago(date: Date, now = Date.now()): string {
  const s = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return "just now";
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}

/** "Last synchronized" with honest states: never, partial, failing, mock. */
export function SyncIndicator({
  provider,
}: {
  provider: {
    isMock: boolean;
    lastSuccessfulSyncAt: Date | null;
    lastSuccessWasPartial: boolean;
    lastRunStatus: string | null;
    accountStatus: string;
  } | null;
}) {
  if (!provider) return <Badge tone="outline">Not connected to SE Ranking</Badge>;
  if (provider.isMock) return <Badge tone="warning">Development mock: not live data</Badge>;
  const when = provider.lastSuccessfulSyncAt;
  const failing =
    provider.lastRunStatus === "failed" ||
    provider.accountStatus === "needs_reauth" ||
    provider.accountStatus === "error";
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <Badge
        tone={
          failing
            ? "destructive"
            : provider.lastSuccessWasPartial
              ? "warning"
              : when
                ? "success"
                : "neutral"
        }
      >
        {failing
          ? "Last sync failed"
          : provider.lastSuccessWasPartial
            ? "Partly synced"
            : when
              ? "Synced"
              : "Never synced"}
      </Badge>
      {when ? (
        <time dateTime={when.toISOString()} title={when.toISOString()}>
          {ago(when)}
        </time>
      ) : null}
    </span>
  );
}
