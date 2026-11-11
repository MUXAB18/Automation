"use client";

import { Loader2 } from "lucide-react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useFormToast } from "@/hooks/use-form-toast";
import { useServerForm } from "@/hooks/use-server-form";
import { connectGoogleServiceAccountAction } from "../../actions";

/** Paste a service account key file. It is sent to the server once, tested, stored encrypted, and never shown again. */
export function ServiceAccountForm({
  clientId,
  providerKey,
}: {
  clientId: string;
  providerKey: string;
}) {
  const { state, pending, onSubmit, formRef } = useServerForm(connectGoogleServiceAccountAction);
  useFormToast(state);
  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-3" autoComplete="off">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="providerKey" value={providerKey} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="key" className="text-sm font-medium">
          Service account key (JSON)
        </label>
        <Textarea
          id="key"
          name="key"
          required
          rows={5}
          spellCheck={false}
          placeholder='{ "type": "service_account", "client_email": "…", "private_key": "…" }'
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          Paste the whole file. Only the email and private key are kept, encrypted. It cannot be
          viewed again.
        </p>
      </div>
      <FormMessage error={state.error} />
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Test and connect
      </Button>
    </form>
  );
}
