"use client";

import { useRef, useTransition } from "react";
import { FolderKanban, Building2 } from "lucide-react";
import { setScopeAction } from "@/app/(dashboard)/actions";
import { cn } from "@/lib/utils";

type Option = { id: string; name: string; hint?: string };

/**
 * Client and project selector. Choosing a client narrows every list and the Overview to it; choosing
 * a project narrows further. The server stores the choice only if the user may access it.
 */
export function ScopeSwitcher({
  clients,
  clientId,
  projects,
  projectId,
}: {
  clients: Option[];
  clientId: string | undefined;
  projects: Option[];
  projectId: string | undefined;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();

  if (clients.length === 0) {
    return <span className="text-sm text-muted-foreground">No clients assigned</span>;
  }
  const submit = () => start(() => formRef.current?.requestSubmit());
  const select =
    "h-9 max-w-44 cursor-pointer rounded-lg border border-border bg-card pl-8 pr-2 text-sm font-medium shadow-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 sm:max-w-56";
  return (
    <form
      ref={formRef}
      action={setScopeAction}
      aria-busy={pending}
      className={cn("flex items-center gap-2", pending && "opacity-70")}
    >
      <div className="relative">
        <Building2
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <select
          name="clientId"
          aria-label="Client"
          value={clientId ?? "all"}
          onChange={() => {
            // Changing client clears the project: it may not exist in the new client.
            const project = formRef.current?.elements.namedItem(
              "projectId",
            ) as HTMLSelectElement | null;
            if (project) project.value = "";
            submit();
          }}
          className={select}
        >
          <option value="all">All clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.hint ? ` (${c.hint})` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="relative hidden sm:block">
        <FolderKanban
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <select
          name="projectId"
          aria-label="Project"
          value={projectId ?? ""}
          disabled={!clientId}
          onChange={submit}
          className={select}
          title={clientId ? undefined : "Choose a client to pick a project"}
        >
          <option value="">{clientId ? "All projects" : "Projects"}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.hint ? ` (${p.hint})` : ""}
            </option>
          ))}
        </select>
      </div>
    </form>
  );
}
