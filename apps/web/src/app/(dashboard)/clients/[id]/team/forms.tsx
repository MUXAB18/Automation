"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { FormField } from "@/components/form-field";
import { FormMessage } from "@/components/form-message";
import { RoleCheckboxes, type RoleOption } from "@/components/role-checkboxes";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { useFormToast } from "@/hooks/use-form-toast";
import type { FormState } from "@/lib/action-state";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export function OwnerForm({
  action,
  ownerId,
  options,
}: {
  action: Action;
  ownerId: string | null;
  options: { userId: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  useFormToast(state);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <FormField
        id="ownerId"
        label="Account owner"
        hint="The person responsible for this client."
        error={state.fieldErrors?.accountOwnerId?.join(" ")}
        className="min-w-64 flex-1"
      >
        {(c) => (
          <NativeSelect name="ownerId" defaultValue={ownerId ?? ""} {...c}>
            <option value="">No owner</option>
            {options.map((o) => (
              <option key={o.userId} value={o.userId}>
                {o.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Save owner
      </Button>
      {state.error ? (
        <div className="w-full">
          <FormMessage error={state.error} />
        </div>
      ) : null}
    </form>
  );
}

export function AddMemberForm({
  action,
  candidates,
  roles,
}: {
  action: Action;
  candidates: { userId: string; name: string; email: string }[];
  roles: RoleOption[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  useFormToast(state);
  if (candidates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Everyone on the agency team already works on this client. Invite more people from the Team
        page.
      </p>
    );
  }
  return (
    <form action={formAction} className="grid gap-4">
      <FormField id="userId" label="Person" required>
        {(c) => (
          <NativeSelect name="userId" defaultValue="" required {...c}>
            <option value="" disabled>
              Choose a team member
            </option>
            {candidates.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.name} ({p.email})
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <RoleCheckboxes roles={roles} idPrefix="add" />
      <FormMessage error={state.error} />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Add to client team
      </Button>
    </form>
  );
}

export function EditRolesForm({
  action,
  userId,
  roles,
  selected,
}: {
  action: Action;
  userId: string;
  roles: RoleOption[];
  selected: string[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  useFormToast(state);
  return (
    <form action={formAction} className="grid gap-3">
      <input type="hidden" name="userId" value={userId} />
      <RoleCheckboxes roles={roles} selected={selected} idPrefix={`roles-${userId}`} />
      <FormMessage error={state.error} />
      <Button type="submit" size="sm" disabled={pending} className="self-start">
        Save roles
      </Button>
    </form>
  );
}
