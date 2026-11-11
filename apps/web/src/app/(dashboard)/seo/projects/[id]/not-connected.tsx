import { Plug } from "lucide-react";
import { EmptyState } from "@/components/states";

/** Shown when a view has no data and nothing is connected to produce it. Never fills in fake numbers. */
export function NotConnected({ what }: { what: string }) {
  return (
    <EmptyState
      icon={Plug}
      title={`No ${what} yet`}
      description="This project is not linked to an SE Ranking project, or nothing has been imported yet. Connect SE Ranking, link the project and run a sync to see this data."
      action={{ label: "Open integrations", href: "/integrations" }}
    />
  );
}
