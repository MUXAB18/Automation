"use client";

import { useActionState } from "react";
import type { ClientStatus } from "@automation/db";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/action-state";

const TRANSITIONS: Record<
  ClientStatus,
  { status: ClientStatus; label: string; variant: "outline" | "destructive" }[]
> = {
  active: [
    { status: "paused", label: "Pause", variant: "outline" },
    { status: "archived", label: "Archive", variant: "destructive" },
  ],
  paused: [
    { status: "active", label: "Resume", variant: "outline" },
    { status: "archived", label: "Archive", variant: "destructive" },
  ],
  archived: [{ status: "active", label: "Restore", variant: "outline" }],
};

export function StatusControls({
  status,
  action,
}: {
  status: ClientStatus;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      {TRANSITIONS[status].map((t) => (
        <Button
          key={t.status}
          type="submit"
          name="status"
          value={t.status}
          variant={t.variant}
          size="sm"
          disabled={pending}
        >
          {t.label}
        </Button>
      ))}
      {state.error ? (
        <span role="alert" className="text-sm text-destructive">
          {state.error}
        </span>
      ) : null}
      {state.ok ? (
        <span role="status" className="text-sm text-success">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
