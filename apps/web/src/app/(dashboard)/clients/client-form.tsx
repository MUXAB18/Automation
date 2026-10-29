"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/action-state";

type Values = {
  name?: string;
  slug?: string;
  reportEmail?: string | null;
  reportIntervalDays?: number;
};

function Field({
  label,
  name,
  errors,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
  errors?: string[];
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} aria-invalid={errors ? true : undefined} {...props} />
      {hint && !errors ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {errors?.map((e) => (
        <p key={e} className="text-xs text-destructive">
          {e}
        </p>
      ))}
    </div>
  );
}

export function ClientForm({
  action,
  mode,
  values = {},
  readOnly = false,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  mode: "create" | "edit";
  values?: Values;
  readOnly?: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const fe = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <Field
        label="Name"
        name="name"
        defaultValue={values.name}
        required
        readOnly={readOnly}
        errors={fe.name}
      />
      <Field
        label="Slug"
        name="slug"
        defaultValue={values.slug}
        required={mode === "edit"}
        readOnly={readOnly}
        errors={fe.slug}
        hint={
          mode === "create"
            ? "Optional. Generated from the name if left empty."
            : "Lowercase letters, numbers and dashes."
        }
      />
      {mode === "create" ? (
        <Field
          label="Primary website"
          name="primaryDomain"
          placeholder="example.com"
          errors={fe.primaryDomain}
          hint="Optional. More websites can be added later."
        />
      ) : null}
      <Field
        label="Report email"
        name="reportEmail"
        type="email"
        defaultValue={values.reportEmail ?? ""}
        readOnly={readOnly}
        errors={fe.reportEmail}
        hint="Where the performance report is sent."
      />
      <Field
        label="Report interval (days)"
        name="reportIntervalDays"
        type="number"
        min={1}
        max={365}
        defaultValue={values.reportIntervalDays ?? 15}
        readOnly={readOnly}
        errors={fe.reportIntervalDays}
      />
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="text-sm text-success">
          {state.message}
        </p>
      ) : null}
      {readOnly ? (
        <p className="text-sm text-muted-foreground">You have read-only access to this client.</p>
      ) : (
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : mode === "create" ? "Create client" : "Save changes"}
          </Button>
        </div>
      )}
    </form>
  );
}
