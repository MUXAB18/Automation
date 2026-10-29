"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog, type ConfirmResult } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useFormToast } from "@/hooks/use-form-toast";
import { Input } from "@/components/ui/input";
import type { FormState } from "@/lib/action-state";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export function WebsitesPanel({
  websites,
  canManage,
  addAction,
  removeConfirmAction,
}: {
  websites: { id: string; domain: string; isPrimary: boolean }[];
  canManage: boolean;
  addAction: Action;
  removeConfirmAction: (formData: FormData) => Promise<ConfirmResult>;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(addAction, {});
  useFormToast(state);
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
              {canManage ? (
                <ConfirmDialog
                  triggerLabel="Remove"
                  triggerVariant="ghost"
                  title={`Remove ${site.domain}?`}
                  description="The website is removed from this client. Keywords and pages already collected for it are kept in history where they are referenced."
                  confirmLabel="Remove website"
                  destructive
                  action={removeConfirmAction}
                  fields={{ websiteId: site.id }}
                />
              ) : null}
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
