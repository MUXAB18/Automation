"use client";

import { Loader2 } from "lucide-react";
import { CHANNELS } from "@/lib/content-constants";
import { FormField } from "@/components/form-field";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useFormToast } from "@/hooks/use-form-toast";
import { useServerForm } from "@/hooks/use-server-form";
import type { FormState } from "@/lib/action-state";
import { errorsFor } from "@/lib/form-errors";

export function NewContentForm({
  action,
  clientId,
  clientName,
  timezone,
  projects,
}: {
  action: (p: FormState, f: FormData) => Promise<FormState>;
  clientId: string;
  clientName: string;
  timezone: string;
  projects: { id: string; name: string }[];
}) {
  const { state, pending, onSubmit } = useServerForm(action);
  useFormToast(state);
  const fe = state.fieldErrors;
  return (
    <form onSubmit={onSubmit} className="grid max-w-3xl gap-4" noValidate>
      <input type="hidden" name="clientId" value={clientId} />
      <p className="text-sm text-muted-foreground">
        Client: <span className="font-medium text-foreground">{clientName}</span> · time zone{" "}
        {timezone}
      </p>
      <FormField id="title" label="Title" required error={errorsFor(fe, "title")}>
        {(c) => <Input name="title" maxLength={200} {...c} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField id="channel" label="Channel" required error={errorsFor(fe, "channel")}>
          {(c) => (
            <NativeSelect name="channel" defaultValue="linkedin" {...c}>
              {CHANNELS.map((ch) => (
                <option key={ch} value={ch}>
                  {ch.replace("_", " ")}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="type" label="Type" error={errorsFor(fe, "type")}>
          {(c) => (
            <NativeSelect name="type" defaultValue="social_post" {...c}>
              {[
                ["social_post", "Social post"],
                ["blog_post", "Blog post"],
                ["page_update", "Page update"],
                ["email", "Email"],
                ["other", "Other"],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="status" label="Start as" error={errorsFor(fe, "status")}>
          {(c) => (
            <NativeSelect name="status" defaultValue="draft" {...c}>
              <option value="idea">Idea</option>
              <option value="brief">Brief</option>
              <option value="draft">Draft</option>
            </NativeSelect>
          )}
        </FormField>
      </div>
      {projects.length > 0 ? (
        <FormField id="projectId" label="Project" error={errorsFor(fe, "projectId")}>
          {(c) => (
            <NativeSelect name="projectId" defaultValue="" {...c}>
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : null}
      <FormField id="brief" label="Idea or brief" error={errorsFor(fe, "brief")}>
        {(c) => <Textarea name="brief" rows={3} maxLength={10000} {...c} />}
      </FormField>
      <FormField id="body" label="Text (caption or body)" error={errorsFor(fe, "body")}>
        {(c) => <Textarea name="body" rows={6} maxLength={100000} {...c} />}
      </FormField>
      <FormField
        id="hashtags"
        label="Hashtags"
        hint="Separate with spaces or commas."
        error={errorsFor(fe, "meta.hashtags")}
      >
        {(c) => <Input name="hashtags" {...c} />}
      </FormField>
      <FormField
        id="scheduledLocal"
        label={`Planned publish time (${timezone})`}
        hint="Optional. It only plans the date: the content still has to be reviewed and approved before it can be scheduled."
        error={errorsFor(fe, "scheduledLocal")}
      >
        {(c) => <Input name="scheduledLocal" type="datetime-local" {...c} />}
      </FormField>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="requiresClientApproval" className="size-4 accent-primary" />
        The client must approve this after internal review
      </label>
      <FormMessage error={state.error} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}Create
        </Button>
      </div>
    </form>
  );
}
