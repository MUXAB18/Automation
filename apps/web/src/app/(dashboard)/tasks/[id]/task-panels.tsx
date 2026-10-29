"use client";

import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
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
import {
  assignTaskAction,
  addCommentAction,
  addDependencyAction,
  deleteCommentAction,
  deleteTimeAction,
  logTimeAction,
  removeAttachmentAction,
  removeDependencyAction,
  uploadAttachmentAction,
} from "../actions";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

function Submit({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" size="sm" disabled={pending} className="self-start">
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </Button>
  );
}

export function AssignForm({
  taskId,
  assigneeId,
  people,
  userId,
  canAssign,
  selfClaim,
}: {
  taskId: string;
  assigneeId: string | null;
  people: { id: string; name: string }[];
  userId: string;
  canAssign: boolean;
  selfClaim: boolean;
}) {
  if (!canAssign && !selfClaim) return null;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const result = await assignTaskAction(data);
        if (result.error) toast.error(result.error);
        else toast.success(result.success ?? "Assignment updated");
      }}
    >
      <input type="hidden" name="taskId" value={taskId} />
      {canAssign ? (
        <FormField id="assigneeId" label="Assign to" className="min-w-48 flex-1">
          {(c) => (
            <NativeSelect name="assigneeId" defaultValue={assigneeId ?? ""} {...c}>
              <option value="">Nobody (backlog)</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : (
        <input type="hidden" name="assigneeId" value={userId} />
      )}
      <Button type="submit" size="sm" variant={canAssign ? "outline" : "default"}>
        {canAssign ? "Save" : "Take this task"}
      </Button>
    </form>
  );
}

export function CommentForm({ action }: { action: Action }) {
  const { state, pending, onSubmit, formRef } = useServerForm(action);
  useFormToast(state);
  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-2" noValidate>
      <FormField id="body" label="Add a comment" error={errorsFor(state.fieldErrors, "_form")}>
        {(c) => (
          <Textarea
            name="body"
            rows={3}
            maxLength={5000}
            placeholder="Share an update or ask a question"
            {...c}
          />
        )}
      </FormField>
      <FormMessage error={state.error && !state.fieldErrors ? state.error : undefined} />
      <Submit pending={pending}>Comment</Submit>
    </form>
  );
}

export function DeleteCommentButton({ taskId, commentId }: { taskId: string; commentId: string }) {
  return (
    <ConfirmDialog
      triggerLabel="Delete"
      triggerVariant="ghost"
      title="Delete this comment?"
      description="The comment is hidden from the discussion. It stays in the audit record."
      confirmLabel="Delete comment"
      destructive
      action={deleteCommentAction}
      fields={{ taskId, commentId }}
    />
  );
}

export function LogTimeForm({ action }: { action: Action }) {
  const { state, pending, onSubmit, formRef } = useServerForm(action);
  useFormToast(state);
  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-3" noValidate>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <FormField id="hours" label="Hours">
          {(c) => (
            <Input name="hours" type="number" min={0} max={24} step={1} defaultValue={0} {...c} />
          )}
        </FormField>
        <FormField id="minutes" label="Minutes" error={errorsFor(state.fieldErrors, "minutes")}>
          {(c) => (
            <Input
              name="minutes"
              type="number"
              min={0}
              max={59}
              step={5}
              defaultValue={30}
              {...c}
            />
          )}
        </FormField>
        <FormField
          id="workedOn"
          label="Day"
          className="col-span-2"
          error={errorsFor(state.fieldErrors, "workedOn")}
        >
          {(c) => <Input name="workedOn" type="date" {...c} />}
        </FormField>
      </div>
      <FormField id="timeNote" label="Note" error={errorsFor(state.fieldErrors, "note")}>
        {(c) => <Input name="note" maxLength={500} placeholder="What did you work on?" {...c} />}
      </FormField>
      <FormMessage error={state.error && !state.fieldErrors ? state.error : undefined} />
      <Submit pending={pending}>Log time</Submit>
    </form>
  );
}

export function DeleteTimeButton({ taskId, entryId }: { taskId: string; entryId: string }) {
  return (
    <ConfirmDialog
      triggerLabel="Remove"
      triggerVariant="ghost"
      title="Remove this time entry?"
      description="The logged time is deleted and the task's actual effort goes down."
      confirmLabel="Remove entry"
      destructive
      action={deleteTimeAction}
      fields={{ taskId, entryId }}
    />
  );
}

export function DependencyForm({
  candidates,
  action,
}: {
  candidates: { id: string; title: string }[];
  action: Action;
}) {
  const { state, pending, onSubmit, formRef } = useServerForm(action);
  useFormToast(state);
  if (candidates.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        There are no other open tasks for this client to wait for.
      </p>
    );
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <FormField
        id="dependsOnTaskId"
        label="This task waits for"
        className="min-w-56 flex-1"
        error={errorsFor(state.fieldErrors, "dependsOnTaskId")}
      >
        {(c) => (
          <NativeSelect name="dependsOnTaskId" defaultValue="" required {...c}>
            <option value="" disabled>
              Choose a task
            </option>
            {candidates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <Submit pending={pending}>Add</Submit>
      {state.error && !state.fieldErrors ? (
        <div className="w-full">
          <FormMessage error={state.error} />
        </div>
      ) : null}
    </form>
  );
}

export function RemoveDependencyButton({
  taskId,
  dependsOnTaskId,
  title,
}: {
  taskId: string;
  dependsOnTaskId: string;
  title: string;
}) {
  return (
    <ConfirmDialog
      triggerLabel="Remove"
      triggerVariant="ghost"
      title="Stop waiting for this task?"
      description={`“${title}” will no longer have to finish before this task can start or complete.`}
      confirmLabel="Remove dependency"
      action={removeDependencyAction}
      fields={{ taskId, dependsOnTaskId }}
    />
  );
}

export function UploadForm({ action }: { action: Action }) {
  const { state, pending, onSubmit, formRef } = useServerForm(action);
  useFormToast(state);
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <FormField
        id="file"
        label="Attach a file"
        hint="Images, PDF, text, CSV, Word, Excel or ZIP, up to 10 MB."
        className="min-w-56 flex-1"
      >
        {(c) => (
          <Input
            name="file"
            type="file"
            required
            accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.csv,.docx,.xlsx,.zip"
            className="h-auto py-2 file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm"
            {...c}
          />
        )}
      </FormField>
      <Submit pending={pending}>Upload</Submit>
      {state.error ? (
        <div className="w-full">
          <FormMessage error={state.error} />
        </div>
      ) : null}
    </form>
  );
}

export function RemoveAttachmentButton({
  taskId,
  attachmentId,
  name,
}: {
  taskId: string;
  attachmentId: string;
  name: string;
}) {
  return (
    <ConfirmDialog
      triggerLabel="Remove"
      triggerVariant="ghost"
      title={`Remove ${name}?`}
      description="The file is no longer available from this task."
      confirmLabel="Remove file"
      destructive
      action={removeAttachmentAction}
      fields={{ taskId, attachmentId }}
    />
  );
}

export { addCommentAction, addDependencyAction, logTimeAction, uploadAttachmentAction };
