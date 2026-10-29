"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ALLOWED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  TASK_STATUSES,
  addAttachment,
  addComment,
  addDependency,
  assignTask,
  createTask,
  deleteComment,
  deleteTimeEntry,
  logTime,
  reassignOpenTasks,
  removeAttachment,
  removeDependency,
  transitionTask,
  updateTask,
  type TaskStatusName,
} from "@automation/db";
import { errorMessage, toFormState, type FormState } from "@/lib/action-state";
import { fileMatchesType } from "@/lib/file-signature";
import { taskInput, text } from "@/lib/form-input";
import { requireActor } from "@/lib/session";
import { deleteStoredFile, saveFile } from "@/lib/storage";

/** What dialogs and menus get back: a message to show in a toast. */
export type Result = { error?: string; success?: string };

function refresh(taskId?: string) {
  revalidatePath("/tasks", "layout");
  revalidatePath("/", "layout");
  if (taskId) revalidatePath(`/tasks/${taskId}`);
}

// ---- Create / edit ----------------------------------------------------------------------------------

export async function createTaskAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireActor();
  let id: string;
  try {
    id = (
      await createTask(actor, {
        clientId: text(formData, "clientId") ?? "",
        ...taskInput(formData),
      } as never)
    ).id;
  } catch (error) {
    return toFormState(error);
  }
  refresh();
  redirect(`/tasks/${id}`);
}

export async function updateTaskAction(
  taskId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  try {
    const { assigneeId: _ignored, ...input } = taskInput(formData);
    void _ignored;
    await updateTask(actor, taskId, input as never);
  } catch (error) {
    return toFormState(error);
  }
  refresh(taskId);
  redirect(`/tasks/${taskId}`);
}

// ---- Workflow and assignment -------------------------------------------------------------------------

/** Move a task along its workflow (start, submit, approve, request changes, block, complete, cancel, ...). */
export async function transitionTaskAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  const to = text(formData, "to");
  if (!TASK_STATUSES.some((s) => s === to)) return { error: "Unknown status" };
  const taskId = text(formData, "taskId") ?? "";
  try {
    await transitionTask(actor, taskId, {
      to: to as TaskStatusName,
      note: text(formData, "note"),
      evidence: { note: text(formData, "evidenceNote"), links: text(formData, "evidenceLinks") },
    });
  } catch (error) {
    return { error: errorMessage(error) };
  }
  refresh(taskId);
  return { success: "Task updated" };
}

export async function assignTaskAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  const taskId = text(formData, "taskId") ?? "";
  try {
    await assignTask(actor, taskId, text(formData, "assigneeId") || null);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  refresh(taskId);
  return { success: "Assignment updated" };
}

export async function reassignAllAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  try {
    const { moved, skipped } = await reassignOpenTasks(actor, {
      fromUserId: text(formData, "fromUserId") ?? "",
      toUserId: text(formData, "toUserId") ?? "",
    });
    refresh();
    return moved === 0
      ? {
          error:
            "Nothing was moved: you can only reassign tasks on clients where you manage assignments, to someone who works on them",
        }
      : {
          success: `${moved} task${moved > 1 ? "s" : ""} reassigned${skipped ? `, ${skipped} skipped` : ""}`,
        };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

// ---- Comments, time, dependencies --------------------------------------------------------------------

export async function addCommentAction(
  taskId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  try {
    await addComment(actor, taskId, text(formData, "body") ?? "");
  } catch (error) {
    return toFormState(error);
  }
  refresh(taskId);
  return { ok: true, message: "Comment added" };
}

export async function deleteCommentAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  try {
    await deleteComment(actor, text(formData, "commentId") ?? "");
  } catch (error) {
    return { error: errorMessage(error) };
  }
  refresh(text(formData, "taskId"));
  return { success: "Comment removed" };
}

export async function logTimeAction(
  taskId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  const hours = Number(text(formData, "hours") || 0);
  const minutes = Number(text(formData, "minutes") || 0);
  try {
    await logTime(actor, taskId, {
      minutes: Math.round(hours * 60 + minutes),
      note: text(formData, "note"),
      workedOn: text(formData, "workedOn"),
    });
  } catch (error) {
    return toFormState(error);
  }
  refresh(taskId);
  return { ok: true, message: "Time logged" };
}

export async function deleteTimeAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  try {
    await deleteTimeEntry(actor, text(formData, "entryId") ?? "");
  } catch (error) {
    return { error: errorMessage(error) };
  }
  refresh(text(formData, "taskId"));
  return { success: "Time entry removed" };
}

export async function addDependencyAction(
  taskId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  try {
    await addDependency(actor, taskId, text(formData, "dependsOnTaskId") ?? "");
  } catch (error) {
    return toFormState(error);
  }
  refresh(taskId);
  return { ok: true, message: "Dependency added" };
}

export async function removeDependencyAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  const taskId = text(formData, "taskId") ?? "";
  try {
    await removeDependency(actor, taskId, text(formData, "dependsOnTaskId") ?? "");
  } catch (error) {
    return { error: errorMessage(error) };
  }
  refresh(taskId);
  return { success: "Dependency removed" };
}

// ---- Attachments ----------------------------------------------------------------------------------------

export async function uploadAttachmentAction(
  taskId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload" };
  // Cheap checks first, before reading the bytes.
  if (file.size > MAX_ATTACHMENT_BYTES) return { error: "Files can be at most 10 MB" };
  if (!(ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(file.type)) {
    return {
      error: "That file type is not allowed. Use images, PDF, text, CSV, Word, Excel or ZIP",
    };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!fileMatchesType(file.type, bytes))
    return { error: "The file's content does not match its type" };

  const stored = await saveFile(bytes);
  try {
    await addAttachment(actor, taskId, {
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: bytes.byteLength,
      ...stored,
    });
  } catch (error) {
    // Nothing should be left on disk for a record that was refused.
    await deleteStoredFile(stored.storageKey);
    return toFormState(error);
  }
  refresh(taskId);
  return { ok: true, message: "File attached" };
}

export async function removeAttachmentAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  try {
    await removeAttachment(actor, text(formData, "attachmentId") ?? "");
  } catch (error) {
    return { error: errorMessage(error) };
  }
  refresh(text(formData, "taskId"));
  return { success: "File removed" };
}
