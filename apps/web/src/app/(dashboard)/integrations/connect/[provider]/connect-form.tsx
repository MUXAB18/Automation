"use client";

import { Loader2 } from "lucide-react";
import { FormField } from "@/components/form-field";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useFormToast } from "@/hooks/use-form-toast";
import { useServerForm } from "@/hooks/use-server-form";
import { errorsFor } from "@/lib/form-errors";
import { connectIntegrationAction } from "../../actions";

type Field = {
  name: string;
  label: string;
  secret: boolean;
  required: boolean;
  help?: string;
  options?: readonly { value: string; label: string }[];
};

export function ConnectForm({
  clientId,
  providerKey,
  live,
  fields,
  scenarios,
}: {
  clientId: string;
  providerKey: string;
  live: boolean;
  fields: Field[];
  scenarios: { value: string; label: string }[];
}) {
  const { state, pending, onSubmit, formRef } = useServerForm(connectIntegrationAction);
  useFormToast(state);
  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className="flex max-w-lg flex-col gap-4"
      autoComplete="off"
    >
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="providerKey" value={providerKey} />
      <input type="hidden" name="mode" value={live ? "live" : "mock"} />
      {fields.map((f) => (
        <FormField
          key={f.name}
          id={f.name}
          label={f.label}
          required={f.required}
          hint={f.help}
          error={errorsFor(state.fieldErrors, f.name)}
        >
          {(props) =>
            f.options ? (
              <NativeSelect name={f.name} defaultValue={scenarios[0]?.value} {...props}>
                {(f.options ?? scenarios).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <Input
                name={f.name}
                // Secrets are write-only: typed here once, never rendered back.
                type={f.secret ? "password" : "text"}
                autoComplete="off"
                {...props}
              />
            )
          }
        </FormField>
      ))}
      <FormMessage error={state.error} />
      <p className="text-xs text-muted-foreground">
        {live
          ? "The connection is tested before anything is saved. Credentials are encrypted and cannot be viewed afterwards."
          : "The mock connection is tested like a real one, but no provider is contacted."}
      </p>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {live ? "Test and connect" : "Connect development mock"}
      </Button>
    </form>
  );
}
