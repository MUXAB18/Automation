"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FormState } from "@/lib/action-state";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

function RemoveButton({ websiteId, action }: { websiteId: string; action: Action }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="websiteId" value={websiteId} />
      {state.error ? (
        <span role="alert" className="text-xs text-destructive">
          {state.error}
        </span>
      ) : null}
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        Remove
      </Button>
    </form>
  );
}

export function WebsitesPanel({
  websites,
  canManage,
  addAction,
  removeAction,
}: {
  websites: { id: string; domain: string; isPrimary: boolean }[];
  canManage: boolean;
  addAction: Action;
  removeAction: Action;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(addAction, {});
  return (
    <div className="flex flex-col gap-4">
      {websites.length === 0 ? (
        <p className="text-sm text-muted-foreground">No websites yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {websites.map((site) => (
            <li key={site.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="flex items-center gap-2 text-sm">
                {site.domain}
                {site.isPrimary ? <Badge>primary</Badge> : null}
              </span>
              {canManage ? <RemoveButton websiteId={site.id} action={removeAction} /> : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <form action={formAction} className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Input name="domain" placeholder="example.com" aria-label="Website domain" required />
            <Button type="submit" disabled={pending}>
              Add
            </Button>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" name="isPrimary" /> Make primary
          </label>
          {state.error ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}
          {state.fieldErrors?.domain?.map((e) => (
            <p key={e} className="text-sm text-destructive">
              {e}
            </p>
          ))}
          {state.ok ? (
            <p role="status" className="text-sm text-success">
              {state.message}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
