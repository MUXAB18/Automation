"use client";

import { useActionState } from "react";
import type { ClientStatus } from "@automation/db";
import { ConfirmDialog, type ConfirmResult } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useFormToast } from "@/hooks/use-form-toast";
import type { FormState } from "@/lib/action-state";

const TRANSITIONS: Record<ClientStatus, { status: ClientStatus; label: string }[]> = {
  active: [{ status: "paused", label: "Pause" }],
  paused: [{ status: "active", label: "Resume" }],
  archived: [{ status: "active", label: "Restore" }],
};

export function StatusControls({
  status,
  action,
  confirmAction,
  clientName,
}: {
  status: ClientStatus;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  confirmAction: (formData: FormData) => Promise<ConfirmResult>;
  clientName: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  useFormToast(state);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={formAction} className="flex gap-2">
        {TRANSITIONS[status].map((t) => (
          <Button
            key={t.status}
            type="submit"
            name="status"
            value={t.status}
            variant="outline"
            size="sm"
            disabled={pending}
          >
            {t.label}
          </Button>
        ))}
      </form>
      {status !== "archived" ? (
        <ConfirmDialog
          triggerLabel="Archive"
          triggerVariant="outline"
          triggerClassName="text-destructive"
          title={`Archive ${clientName}?`}
          description="Archived clients are hidden from selectors and stop being processed by scheduled jobs. Their data is kept and you can restore the client later."
          confirmLabel="Archive client"
          destructive
          action={confirmAction}
          fields={{ status: "archived" }}
        />
      ) : null}
    </div>
  );
}
