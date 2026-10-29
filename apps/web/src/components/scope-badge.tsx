import { Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Scope } from "@/lib/scope";

/** Reminds the reader that the header's client/project selection is narrowing this page. */
export function ScopeBadge({ scope }: { scope: Scope }) {
  const client = scope.clients.find((c) => c.id === scope.clientId);
  if (!client) return null;
  const project = scope.projects.find((p) => p.id === scope.projectId);
  return (
    <Badge
      tone="primary"
      className="gap-1"
      title="Change this with the client and project selectors in the header"
    >
      <Building2 className="size-3" aria-hidden />
      {client.name}
      {project ? ` / ${project.name}` : ""}
    </Badge>
  );
}
