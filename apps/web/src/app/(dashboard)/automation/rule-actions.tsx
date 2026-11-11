"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { archiveRuleAction, runRuleNowAction, setRuleEnabledAction, type Result } from "./actions";

function useRun() {
  const [pending, start] = useTransition();
  const run = (action: (f: FormData) => Promise<Result>, fields: Record<string, string>) =>
    start(async () => {
      const data = new FormData();
      for (const [k, v] of Object.entries(fields)) data.set(k, v);
      const r = await action(data);
      if (r.error) toast.error(r.error);
      else toast.success(r.success ?? "Done");
    });
  return { pending, run };
}

/** Row actions for one rule. Rendered only for people who may manage rules; the server checks again. */
export function RuleActions({ id, active }: { id: string; active: boolean }) {
  const { pending, run } = useRun();
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => run(setRuleEnabledAction, { ruleId: id, enabled: String(!active) })}
      >
        {active ? "Pause" : "Enable"}
      </Button>
      {active ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(runRuleNowAction, { ruleId: id })}
        >
          Run now
        </Button>
      ) : null}
      <Button size="sm" variant="outline" asChild>
        <Link href={`/automation/${id}/edit`}>Edit</Link>
      </Button>
      <ConfirmDialog
        triggerLabel="Delete"
        triggerVariant="ghost"
        title="Delete this rule?"
        description="The rule stops running. Its past executions and the tasks it created are kept."
        confirmLabel="Delete rule"
        destructive
        action={archiveRuleAction}
        fields={{ ruleId: id }}
      />
    </div>
  );
}

export function InstallRecommended({
  clientId,
  action,
}: {
  clientId: string;
  action: (f: FormData) => Promise<Result>;
}) {
  const { pending, run } = useRun();
  return (
    <Button variant="outline" disabled={pending} onClick={() => run(action, { clientId })}>
      Add the 7 recommended rules
    </Button>
  );
}

export function ApplyTemplate({
  id,
  action,
}: {
  id: string;
  action: (f: FormData) => Promise<Result>;
}) {
  return (
    <ConfirmDialog
      triggerLabel="Apply to all clients"
      title="Apply this template to every active client?"
      description="Each client gets this rule, or its copy is updated. Rules a client has edited themselves are left alone."
      confirmLabel="Apply"
      action={action}
      fields={{ templateId: id }}
    />
  );
}
