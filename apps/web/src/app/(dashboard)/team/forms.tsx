"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inviteAction, removeMemberAction, setRolesAction, type TeamState } from "./actions";

export type RoleOption = { key: string; name: string; scope: string; description: string | null };

function RoleCheckboxes({
  roles,
  selected = [],
  idPrefix,
}: {
  roles: RoleOption[];
  selected?: string[];
  idPrefix: string;
}) {
  return (
    <fieldset className="grid gap-2 sm:grid-cols-2">
      <legend className="sr-only">Roles</legend>
      {roles.map((r) => (
        <label
          key={r.key}
          htmlFor={`${idPrefix}-${r.key}`}
          className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
        >
          <input
            id={`${idPrefix}-${r.key}`}
            type="checkbox"
            name="roleKeys"
            value={r.key}
            defaultChecked={selected.includes(r.key)}
            className="mt-1"
          />
          <span>
            <span className="font-medium">{r.name}</span>
            {r.description ? (
              <span className="block text-xs text-muted-foreground">{r.description}</span>
            ) : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function InviteForm({
  agencyId,
  roles,
  clients,
}: {
  agencyId: string;
  roles: RoleOption[];
  clients: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<TeamState, FormData>(inviteAction, {});
  const [clientId, setClientId] = useState("");
  // Server enforces the same rule; this only hides options that would be refused.
  const offered = roles.filter((r) => (clientId ? true : r.scope === "agency"));
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="agencyId" value={agencyId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            name="email"
            type="email"
            required
            placeholder="name@company.com"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-client">Access to</Label>
          <select
            id="invite-client"
            name="clientId"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
          >
            <option value="">The whole agency</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                Only {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <RoleCheckboxes key={clientId ? "client" : "agency"} roles={offered} idPrefix="invite" />
      {!clientId ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="allClientsAccess" /> Can work on every client of the agency
        </label>
      ) : null}
      <FormMessage error={state.error} success={state.success} />
      {state.inviteUrl ? (
        <div className="rounded-lg border border-border bg-muted p-3 text-xs">
          <p className="mb-1 font-medium">Invitation link (shown once, valid for 7 days)</p>
          <code className="break-all">{state.inviteUrl}</code>
        </div>
      ) : null}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Send invitation
      </Button>
    </form>
  );
}

export function EditMemberForm({
  agencyId,
  userId,
  roles,
  selected,
  allClientsAccess,
}: {
  agencyId: string;
  userId: string;
  roles: RoleOption[];
  selected: string[];
  allClientsAccess: boolean;
}) {
  const [state, action, pending] = useActionState<TeamState, FormData>(setRolesAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="agencyId" value={agencyId} />
      <input type="hidden" name="userId" value={userId} />
      <RoleCheckboxes
        roles={roles.filter((r) => r.scope === "agency")}
        selected={selected}
        idPrefix={`edit-${userId}`}
      />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="allClientsAccess" defaultChecked={allClientsAccess} /> Can work
        on every client of the agency
      </label>
      <FormMessage error={state.error} success={state.success} />
      <Button type="submit" size="sm" disabled={pending} className="self-start">
        Save roles
      </Button>
    </form>
  );
}

export function RemoveMemberForm({
  agencyId,
  userId,
  name,
}: {
  agencyId: string;
  userId: string;
  name: string;
}) {
  const [state, action, pending] = useActionState<TeamState, FormData>(removeMemberAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="agencyId" value={agencyId} />
      <input type="hidden" name="userId" value={userId} />
      <FormMessage error={state.error} />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={pending}
        className="self-start text-destructive"
        aria-label={`Remove ${name}`}
      >
        Remove from team
      </Button>
    </form>
  );
}
