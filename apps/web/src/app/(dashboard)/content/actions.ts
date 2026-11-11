"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addContentComment,
  advanceContent,
  attachMedia,
  createContentItem,
  decideReview,
  markPublishedManually,
  removeMedia,
  reopenAsDraft,
  restoreContentVersion,
  retryPublish,
  saveContentVersion,
  scheduleContent,
  setClientApprovalRequired,
  submitForReview,
  unscheduleContent,
} from "@automation/db";
import { errorMessage, toFormState, type FormState } from "@/lib/action-state";
import { fileMatchesType } from "@/lib/file-signature";
import { text } from "@/lib/form-input";
import { requireActor } from "@/lib/session";
import { deleteStoredFile, saveFile } from "@/lib/storage";

export type Result = { error?: string; success?: string };
const refresh = (id?: string) => {
  revalidatePath("/content", "layout");
  revalidatePath("/portal", "layout");
  if (id) revalidatePath(`/content/${id}`);
};
const hashtags = (formData: FormData) =>
  (text(formData, "hashtags") ?? "")
    .split(/[\s,]+/)
    .map((h) => h.trim())
    .filter(Boolean)
    .map((h) => (h.startsWith("#") ? h : `#${h}`));

export async function createContentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  let id: string;
  try {
    ({ id } = await createContentItem(actor, text(formData, "clientId") ?? "", {
      title: text(formData, "title") ?? "",
      type: (text(formData, "type") ?? "social_post") as never,
      channel: (text(formData, "channel") ?? "") as never,
      status: (text(formData, "status") ?? "draft") as never,
      projectId: text(formData, "projectId") || null,
      brief: text(formData, "brief") || undefined,
      body: text(formData, "body") || undefined,
      meta: { hashtags: hashtags(formData) },
      requiresClientApproval: formData.get("requiresClientApproval") === "on",
      scheduledLocal: text(formData, "scheduledLocal") || undefined,
    }));
  } catch (error) {
    return toFormState(error);
  }
  refresh();
  redirect(`/content/${id}`);
}

export async function saveVersionAction(
  itemId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  try {
    await saveContentVersion(actor, itemId, {
      title: text(formData, "title"),
      body: text(formData, "body") ?? "",
      meta: {
        hashtags: hashtags(formData),
        seoTitle: text(formData, "seoTitle") || undefined,
        metaDescription: text(formData, "metaDescription") || undefined,
      },
      changeNote: text(formData, "changeNote"),
      expectedVersionNo: Number(text(formData, "expectedVersionNo") ?? 0),
    });
  } catch (error) {
    return toFormState(error);
  }
  refresh(itemId);
  return { ok: true, message: "Saved as a new version" };
}

/** Button actions: every one re-checks the permission and the lifecycle on the server. */
async function run(
  itemId: string | undefined,
  success: string,
  fn: () => Promise<unknown>,
): Promise<Result> {
  try {
    await fn();
  } catch (error) {
    return { error: errorMessage(error) };
  }
  refresh(itemId);
  return { success };
}

export async function submitAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  const id = text(formData, "itemId") ?? "";
  return run(id, "Sent for review", () =>
    submitForReview(actor, id, { note: text(formData, "note") }),
  );
}

export async function decideAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  const id = text(formData, "itemId") ?? "";
  const decision = text(formData, "decision") ?? "";
  return run(
    id,
    decision === "approve" ? "Approved" : decision === "reject" ? "Rejected" : "Changes requested",
    () => decideReview(actor, id, { decision: decision as never, note: text(formData, "note") }),
  );
}

export async function commentAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  const id = text(formData, "itemId") ?? "";
  return run(id, "Comment added", () => addContentComment(actor, id, text(formData, "body") ?? ""));
}

export async function advanceAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  const id = text(formData, "itemId") ?? "";
  const to = text(formData, "to") ?? "";
  if (to === "reopen") return run(id, "Reopened as a draft", () => reopenAsDraft(actor, id));
  return run(id, "Updated", () => advanceContent(actor, id, to as never, text(formData, "note")));
}

export async function clientApprovalAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  const id = text(formData, "itemId") ?? "";
  return run(id, "Updated", () =>
    setClientApprovalRequired(actor, id, text(formData, "required") === "true"),
  );
}

export async function restoreAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  const id = text(formData, "itemId") ?? "";
  return run(id, "Restored as a new version", () =>
    restoreContentVersion(actor, id, Number(text(formData, "versionNo"))),
  );
}

export async function scheduleAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  const id = text(formData, "itemId") ?? "";
  const account = text(formData, "integrationAccountId") || undefined;
  return run(
    id,
    account
      ? "Scheduled for publishing"
      : "Scheduled. Someone needs to post it by hand at that time",
    () =>
      scheduleContent(actor, id, {
        scheduledLocal: text(formData, "scheduledLocal") ?? "",
        integrationAccountId: account,
        targetAccountIds: formData
          .getAll("targetAccountIds")
          .filter((v): v is string => typeof v === "string"),
      }),
  );
}

export async function unscheduleAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  const id = text(formData, "itemId") ?? "";
  return run(id, "Unscheduled", () => unscheduleContent(actor, id));
}

export async function manualPublishAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  const id = text(formData, "itemId") ?? "";
  return run(id, "Marked as published", () =>
    markPublishedManually(actor, id, {
      publishedUrl: text(formData, "publishedUrl") || undefined,
      note: text(formData, "note") || undefined,
    }),
  );
}

export async function retryPublishAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  return run(text(formData, "itemId"), "Queued again", () =>
    retryPublish(actor, text(formData, "jobId") ?? ""),
  );
}

export async function uploadMediaAction(
  itemId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload" };
  if (file.size > 200 * 1024 * 1024) return { error: "That file is too large" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!fileMatchesType(file.type, bytes))
    return { error: "The file's content does not match its type" };
  const stored = await saveFile(bytes);
  try {
    await attachMedia(actor, itemId, {
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      storageKey: stored.storageKey,
      sha256: stored.sha256,
      altText: text(formData, "altText"),
    });
  } catch (error) {
    await deleteStoredFile(stored.storageKey).catch(() => undefined);
    return toFormState(error);
  }
  refresh(itemId);
  return { ok: true, message: "File attached" };
}

export async function removeMediaAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  const id = text(formData, "itemId") ?? "";
  return run(id, "File removed", async () => {
    const key = await removeMedia(actor, text(formData, "assetId") ?? "");
    await deleteStoredFile(key).catch(() => undefined);
  });
}
