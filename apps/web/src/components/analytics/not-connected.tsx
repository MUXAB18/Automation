import { Plug } from "lucide-react";
import { EmptyState } from "@/components/states";

export function NoSource({ kind }: { kind: "ga4" | "gsc" }) {
  const name = kind === "ga4" ? "Google Analytics" : "Search Console";
  return (
    <EmptyState
      icon={Plug}
      title={`${name} is not connected for this client`}
      description={`Connect ${name} in Integrations, select a property and run a sync. Nothing is shown until real data has been imported.`}
      action={{ label: "Open integrations", href: "/integrations" }}
    />
  );
}

export function NoRows({ what }: { what: string }) {
  return (
    <p className="py-8 text-center text-sm text-muted-foreground">
      No {what} were stored for this date range.
    </p>
  );
}
