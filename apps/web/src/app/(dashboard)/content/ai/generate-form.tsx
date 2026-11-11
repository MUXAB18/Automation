"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { AiTask } from "@automation/db";
import { TASK_LABEL } from "@/lib/content-constants";
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
import { TASK_FIELDS } from "./fields";

export function GenerateForm({
  action,
  clientId,
  clientName,
  tasks,
  projects,
  sources,
  contentOptions,
  initialTask,
  contentItemId,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  clientId: string;
  clientName: string;
  tasks: AiTask[];
  projects: { id: string; name: string }[];
  sources: { id: string; title: string }[];
  contentOptions: { id: string; title: string; channel: string }[];
  initialTask?: AiTask;
  contentItemId?: string;
}) {
  const { state, pending, onSubmit } = useServerForm(action);
  useFormToast(state);
  const [task, setTask] = useState<AiTask>(initialTask ?? tasks[0]!);
  const nonce = useMemo(() => crypto.randomUUID(), []);
  const fe = state.fieldErrors;
  return (
    <form onSubmit={onSubmit} className="grid max-w-3xl gap-4" noValidate>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="nonce" value={nonce} />
      {contentItemId ? <input type="hidden" name="contentItemId" value={contentItemId} /> : null}
      <p className="text-sm text-muted-foreground">
        Client: <span className="font-medium text-foreground">{clientName}</span>. The model sees
        only this client&apos;s published brand guideline and the approved sources you choose below.
      </p>
      <FormField id="task" label="What do you want?">
        {(c) => (
          <NativeSelect
            name="task"
            value={task}
            onChange={(e) => setTask(e.target.value as AiTask)}
            {...c}
          >
            {tasks.map((t) => (
              <option key={t} value={t}>
                {TASK_LABEL[t]}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
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
      <div key={task} className="grid gap-4">
        {TASK_FIELDS[task].map((f) => {
          const err = errorsFor(fe, f.name);
          if (f.type === "checkbox")
            return (
              <label key={f.name} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name={f.name}
                  defaultChecked={f.defaultValue === true}
                  className="size-4 accent-primary"
                />
                {f.label}
              </label>
            );
          return (
            <FormField
              key={f.name}
              id={`f-${f.name}`}
              label={f.label}
              required={f.required}
              hint={f.hint}
              error={err}
            >
              {(c) =>
                f.type === "textarea" ? (
                  <Textarea name={f.name} rows={3} maxLength={4000} {...c} />
                ) : f.type === "select" ? (
                  <NativeSelect name={f.name} defaultValue={String(f.defaultValue ?? "")} {...c}>
                    {f.name === "sourceContentItemId"
                      ? [
                          <option key="" value="">
                            Choose content
                          </option>,
                          ...contentOptions.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.title} ({o.channel})
                            </option>
                          )),
                        ]
                      : f.options?.map((o) => (
                          <option key={o} value={o}>
                            {o.replace(/_/g, " ")}
                          </option>
                        ))}
                  </NativeSelect>
                ) : (
                  <Input
                    name={f.name}
                    type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                    defaultValue={f.defaultValue === undefined ? undefined : String(f.defaultValue)}
                    {...c}
                  />
                )
              }
            </FormField>
          );
        })}
      </div>
      {sources.length > 0 ? (
        <fieldset className="grid gap-2 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-medium">Approved sources the model may use</legend>
          <p className="text-xs text-muted-foreground">
            None ticked = all approved sources of this client (up to 20).
          </p>
          {sources.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="sourceIds"
                value={s.id}
                className="size-4 accent-primary"
              />
              {s.title}
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="text-xs text-muted-foreground">
          No approved sources yet. The model will rely on the brand guideline and your request only.
        </p>
      )}
      <FormMessage error={state.error} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Generate draft
        </Button>
      </div>
    </form>
  );
}
