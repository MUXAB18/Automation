"use client";

import { Loader2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { useFormToast } from "@/hooks/use-form-toast";
import { useServerForm } from "@/hooks/use-server-form";
import type { FormState } from "@/lib/action-state";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

/** Link one discovered SE Ranking project to a platform SEO project and pick the search engine to track. */
export function LinkProjectForm({
  accountId,
  providerProjectId,
  engines,
  candidates,
  action,
}: {
  accountId: string;
  providerProjectId: string;
  engines: { siteEngineId: number; regionName: string | null; langCode: string | null }[];
  candidates: { id: string; name: string; domain: string }[];
  action: Action;
}) {
  const { state, pending, onSubmit, formRef } = useServerForm(action);
  useFormToast(state);
  if (candidates.length === 0)
    return (
      <p className="text-xs text-muted-foreground">
        No unlinked SEO project exists for this client. Create one first.
      </p>
    );
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-wrap items-end gap-2 text-sm">
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="providerProjectId" value={providerProjectId} />
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Platform SEO project</span>
        <NativeSelect
          name="seoProjectId"
          required
          defaultValue=""
          aria-label="Platform SEO project"
        >
          <option value="" disabled>
            Choose…
          </option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.domain})
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Search engine to track</span>
        <NativeSelect
          name="siteEngineId"
          required
          defaultValue={engines[0]?.siteEngineId}
          aria-label="Search engine"
        >
          {engines.map((e) => (
            <option key={e.siteEngineId} value={e.siteEngineId}>
              {e.regionName ?? `Engine ${e.siteEngineId}`}
              {e.langCode ? ` (${e.langCode})` : ""}
            </option>
          ))}
        </NativeSelect>
      </label>
      <Button type="submit" size="sm" disabled={pending || engines.length === 0}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Link and sync
      </Button>
      <FormMessage error={state.error} />
    </form>
  );
}

export { ConfirmDialog };
