"use client";

import { Loader2 } from "lucide-react";
import { FormField } from "@/components/form-field";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFormToast } from "@/hooks/use-form-toast";
import { useServerForm } from "@/hooks/use-server-form";
import type { FormState } from "@/lib/action-state";
import { errorsFor } from "@/lib/form-errors";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export function SourceForm({ action, clientId }: { action: Action; clientId: string }) {
  const { state, pending, onSubmit, formRef } = useServerForm(action);
  useFormToast(state);
  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className="grid gap-3 border-t border-border pt-4"
      noValidate
    >
      <input type="hidden" name="clientId" value={clientId} />
      <FormField id="title" label="Title" required error={errorsFor(state.fieldErrors, "title")}>
        {(c) => <Input name="title" maxLength={200} {...c} />}
      </FormField>
      <FormField
        id="body"
        label="Text the model may rely on"
        required
        error={errorsFor(state.fieldErrors, "body")}
      >
        {(c) => <Textarea name="body" rows={5} maxLength={20000} {...c} />}
      </FormField>
      <FormField
        id="sourceUrl"
        label="Where it came from (optional)"
        error={errorsFor(state.fieldErrors, "sourceUrl")}
      >
        {(c) => <Input name="sourceUrl" type="url" {...c} />}
      </FormField>
      <FormMessage error={state.error} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}Approve source
        </Button>
      </div>
    </form>
  );
}

export function LimitForm({
  action,
  clientId,
  requests,
  costUsd,
}: {
  action: Action;
  clientId: string;
  requests: number;
  costUsd: number;
}) {
  const { state, pending, onSubmit } = useServerForm(action);
  useFormToast(state);
  return (
    <form onSubmit={onSubmit} className="grid gap-3" noValidate>
      <input type="hidden" name="clientId" value={clientId} />
      <FormField
        id="monthlyRequests"
        label="Requests per month"
        error={errorsFor(state.fieldErrors, "monthlyRequests")}
      >
        {(c) => (
          <Input name="monthlyRequests" type="number" min={0} defaultValue={requests} {...c} />
        )}
      </FormField>
      <FormField
        id="monthlyCostUsd"
        label="Estimated spend cap per month (USD, 0 = none)"
        error={errorsFor(state.fieldErrors, "monthlyCostUsd")}
      >
        {(c) => (
          <Input
            name="monthlyCostUsd"
            type="number"
            min={0}
            step="0.01"
            defaultValue={costUsd}
            {...c}
          />
        )}
      </FormField>
      <FormMessage error={state.error} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}Save limits
        </Button>
      </div>
    </form>
  );
}
