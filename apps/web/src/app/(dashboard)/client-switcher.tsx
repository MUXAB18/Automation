"use client";

import { useRef } from "react";
import { setActiveClientAction } from "./actions";

export function ClientSwitcher({
  options,
  activeId,
  allowAll,
}: {
  options: { id: string; name: string; status: string }[];
  activeId: string | undefined;
  allowAll: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  if (options.length === 0 && !allowAll) {
    return <span className="text-sm text-muted-foreground">No clients assigned</span>;
  }
  return (
    <form ref={formRef} action={setActiveClientAction}>
      <label className="sr-only" htmlFor="client-switcher">
        Client
      </label>
      <select
        id="client-switcher"
        name="clientId"
        value={activeId ?? "all"}
        onChange={() => formRef.current?.requestSubmit()}
        className="h-9 max-w-56 cursor-pointer rounded-lg border border-border bg-card px-3 text-sm font-medium shadow-sm transition-shadow focus-visible:border-ring focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
      >
        {allowAll ? <option value="all">All clients</option> : null}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
            {o.status !== "active" ? ` (${o.status})` : ""}
          </option>
        ))}
      </select>
    </form>
  );
}
