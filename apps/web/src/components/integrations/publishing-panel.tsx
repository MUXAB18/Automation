"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useFormToast } from "@/hooks/use-form-toast";
import { useServerForm } from "@/hooks/use-server-form";
import type { FormState } from "@/lib/action-state";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

/** Queue an approved content item for publishing to chosen social accounts. */
export function PublishForm({
  accountId,
  items,
  socialAccounts,
  action,
}: {
  accountId: string;
  items: { id: string; title: string }[];
  socialAccounts: {
    externalId: string;
    name: string | null;
    platform: string | null;
    isExpired: boolean;
  }[];
  action: Action;
}) {
  const { state, pending, onSubmit, formRef } = useServerForm(action);
  useFormToast(state);
  const usable = socialAccounts.filter((a) => !a.isExpired);
  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-3 text-sm">
      <input type="hidden" name="accountId" value={accountId} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="contentItemId" className="font-medium">
          Approved content
        </label>
        <NativeSelect id="contentItemId" name="contentItemId" required defaultValue="">
          <option value="" disabled>
            Choose content…
          </option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.title}
            </option>
          ))}
        </NativeSelect>
      </div>
      <fieldset className="space-y-1.5">
        <legend className="font-medium">Post to</legend>
        {socialAccounts.map((a) => (
          <label key={a.externalId} className="flex items-center gap-2">
            <input
              type="checkbox"
              name="targetAccountIds"
              value={a.externalId}
              disabled={a.isExpired}
              className="size-4"
            />
            <span>
              {a.name ?? a.externalId}{" "}
              <span className="text-muted-foreground">
                ({a.platform ?? "unknown"}
                {a.isExpired ? ", expired: reconnect it in GoHighLevel" : ""})
              </span>
            </span>
          </label>
        ))}
        {usable.length === 0 ? (
          <p className="text-muted-foreground">
            No usable social accounts. Sync the integration first.
          </p>
        ) : null}
      </fieldset>
      <FormMessage error={state.error} />
      <Button
        type="submit"
        size="sm"
        disabled={pending || items.length === 0 || usable.length === 0}
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Queue for publishing
      </Button>
      <p className="text-xs text-muted-foreground">
        Only content whose current version was approved is listed. Each version can be posted to
        this account once.
      </p>
    </form>
  );
}

/** For a job whose outcome is unclear: the person checks GoHighLevel and records what they found. */
export function ReviewActions({
  jobId,
  accountId,
  resolve,
}: {
  jobId: string;
  accountId: string;
  resolve: (formData: FormData) => Promise<{ error?: string; success?: string }>;
}) {
  const [postId, setPostId] = useState("");
  const [pending, start] = useTransition();
  const run = (outcome: "posted" | "not_posted") =>
    start(async () => {
      const data = new FormData();
      data.set("jobId", jobId);
      data.set("accountId", accountId);
      data.set("outcome", outcome);
      data.set("externalPostId", postId);
      const result = await resolve(data);
      if (result.error) toast.error(result.error);
      else toast.success(result.success ?? "Done");
    });
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-warning/40 p-3 text-xs">
      <p>
        Check GoHighLevel&apos;s social planner for this post, then tell the platform what you
        found.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={postId}
          onChange={(e) => setPostId(e.target.value)}
          placeholder="GoHighLevel post id"
          className="h-8 max-w-56"
          aria-label="GoHighLevel post id"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || !postId.trim()}
          onClick={() => run("posted")}
        >
          It was posted
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run("not_posted")}
        >
          It was not posted
        </Button>
      </div>
    </div>
  );
}
