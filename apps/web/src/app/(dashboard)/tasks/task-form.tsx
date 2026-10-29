"use client";

import { Loader2 } from "lucide-react";
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

export type TaskFormValues = {
  title?: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
  type?: string;
  priority?: string;
  projectId?: string | null;
  dueDate?: string;
  estimateHours?: string;
  assigneeId?: string | null;
  contentItemId?: string | null;
  seoIssueIds?: string[];
  labels?: string[];
};

const TYPES = [
  { value: "general", label: "General" },
  { value: "seo_fix", label: "SEO fix" },
  { value: "content", label: "Content" },
  { value: "social", label: "Social media" },
  { value: "reporting", label: "Reporting" },
];

export function TaskForm({
  action,
  mode,
  clientId,
  clientName,
  values = {},
  projects,
  content,
  issues,
  people,
  canAssign,
  userId,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  mode: "create" | "edit";
  clientId?: string;
  clientName: string;
  values?: TaskFormValues;
  projects: { id: string; name: string }[];
  content: { id: string; title: string }[];
  issues: { id: string; title: string; taskId: string | null }[];
  people: { id: string; name: string }[];
  canAssign: boolean;
  userId: string;
}) {
  const { state, pending, onSubmit } = useServerForm(action);
  useFormToast(state);
  const fe = state.fieldErrors;
  const selectedIssues = new Set(values.seoIssueIds ?? []);
  // An issue already tracked by another task cannot be linked here.
  const linkable = issues.filter((i) => !i.taskId || selectedIssues.has(i.id));

  return (
    <form onSubmit={onSubmit} className="grid max-w-3xl gap-6" noValidate>
      {clientId ? <input type="hidden" name="clientId" value={clientId} /> : null}
      <p className="text-sm text-muted-foreground">
        Client: <span className="font-medium text-foreground">{clientName}</span>
      </p>

      <FormField id="title" label="Title" required error={errorsFor(fe, "title")}>
        {(c) => <Input name="title" defaultValue={values.title} maxLength={200} {...c} />}
      </FormField>
      <FormField
        id="description"
        label="Description"
        hint="What needs doing, and any background. Up to 10,000 characters."
        error={errorsFor(fe, "description")}
      >
        {(c) => (
          <Textarea
            name="description"
            defaultValue={values.description ?? ""}
            rows={5}
            maxLength={10000}
            {...c}
          />
        )}
      </FormField>
      <FormField
        id="acceptanceCriteria"
        label="Acceptance criteria"
        hint="One line per condition that must be true when the task is done. The reviewer checks the work against these."
        error={errorsFor(fe, "acceptanceCriteria")}
      >
        {(c) => (
          <Textarea
            name="acceptanceCriteria"
            defaultValue={values.acceptanceCriteria ?? ""}
            rows={4}
            maxLength={4000}
            {...c}
          />
        )}
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="type" label="Type" error={errorsFor(fe, "type")}>
          {(c) => (
            <NativeSelect name="type" defaultValue={values.type ?? "general"} {...c}>
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="priority" label="Priority" error={errorsFor(fe, "priority")}>
          {(c) => (
            <NativeSelect name="priority" defaultValue={values.priority ?? "medium"} {...c}>
              {["low", "medium", "high", "urgent"].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="projectId" label="Project" error={errorsFor(fe, "projectId")}>
          {(c) => (
            <NativeSelect name="projectId" defaultValue={values.projectId ?? ""} {...c}>
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {mode === "create" ? (
          <FormField
            id="assigneeId"
            label="Assign to"
            hint={
              canAssign
                ? "Leave empty to put it in the backlog."
                : "You can take it yourself; a manager can assign it to others."
            }
            error={errorsFor(fe, "assigneeId")}
          >
            {(c) => (
              <NativeSelect name="assigneeId" defaultValue={values.assigneeId ?? ""} {...c}>
                <option value="">Nobody (backlog)</option>
                {people
                  .filter((p) => canAssign || p.id === userId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id === userId ? `${p.name} (me)` : p.name}
                    </option>
                  ))}
              </NativeSelect>
            )}
          </FormField>
        ) : null}
        <FormField
          id="dueDate"
          label="Due date"
          hint="The task is overdue after this day ends in the client's time zone."
          error={errorsFor(fe, "dueDate")}
        >
          {(c) => <Input name="dueDate" type="date" defaultValue={values.dueDate} {...c} />}
        </FormField>
        <FormField
          id="estimateHours"
          label="Estimated effort (hours)"
          hint="For example 1.5"
          error={errorsFor(fe, "estimateMinutes")}
        >
          {(c) => (
            <Input
              name="estimateHours"
              type="number"
              step="0.25"
              min="0"
              defaultValue={values.estimateHours}
              {...c}
            />
          )}
        </FormField>
      </div>

      <FormField
        id="contentItemId"
        label="Related content"
        hint="Optional. The content item this task is about."
        error={errorsFor(fe, "contentItemId")}
      >
        {(c) => (
          <NativeSelect name="contentItemId" defaultValue={values.contentItemId ?? ""} {...c}>
            <option value="">None</option>
            {content.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>

      {linkable.length > 0 ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Related SEO issues</legend>
          <div className="grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">
            {linkable.map((i) => (
              <label
                key={i.id}
                className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
              >
                <input
                  type="checkbox"
                  name="seoIssueIds"
                  value={i.id}
                  defaultChecked={selectedIssues.has(i.id)}
                  className="mt-1"
                />
                {i.title}
              </label>
            ))}
          </div>
          {errorsFor(fe, "seoIssueIds") ? (
            <p className="text-xs text-destructive">{errorsFor(fe, "seoIssueIds")}</p>
          ) : null}
        </fieldset>
      ) : null}

      <FormField
        id="labels"
        label="Labels"
        hint="Comma-separated, up to 10."
        error={errorsFor(fe, "labels")}
      >
        {(c) => <Input name="labels" defaultValue={(values.labels ?? []).join(", ")} {...c} />}
      </FormField>

      <FormMessage error={state.error} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {mode === "create" ? "Create task" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
