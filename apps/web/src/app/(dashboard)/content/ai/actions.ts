"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  AI_TASKS,
  addApprovedSource,
  archiveApprovedSource,
  cancelAiJob,
  regenerate,
  requestGeneration,
  reviewAiJob,
  saveAiOutputAsDraft,
  setAiLimit,
  type AiTask,
} from "@automation/db";
import { getAiConfig } from "@/lib/ai-config";
import { errorMessage, toFormState, type FormState } from "@/lib/action-state";
import { text } from "@/lib/form-input";
import { requireActor } from "@/lib/session";
import { taskInput } from "./fields";

export type Result = { error?: string; success?: string; redirectTo?: string };
const refresh = () => revalidatePath("/content", "layout");

export async function requestGenerationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  const task = text(formData, "task") ?? "";
  let id: string;
  try {
    if (!(AI_TASKS as readonly string[]).includes(task))
      return { error: "Choose a type of content" };
    ({ id } = await requestGeneration(
      actor,
      {
        clientId: text(formData, "clientId") ?? "",
        projectId: text(formData, "projectId") || null,
        contentItemId: text(formData, "contentItemId") || null,
        task,
        input: taskInput(task as AiTask, formData),
        sourceIds: formData.getAll("sourceIds").filter((v): v is string => typeof v === "string"),
        idempotencyKey: text(formData, "nonce"),
      },
      getAiConfig(),
    ));
  } catch (error) {
    return toFormState(error);
  }
  refresh();
  redirect(`/content/ai/${id}`);
}

export async function regenerateAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  try {
    const { id } = await regenerate(actor, text(formData, "jobId") ?? "", getAiConfig(), {
      feedback: text(formData, "feedback") || undefined,
    });
    refresh();
    return { success: "Generating again", redirectTo: `/content/ai/${id}` };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function reviewAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  try {
    await reviewAiJob(actor, text(formData, "jobId") ?? "", {
      outcome: (text(formData, "outcome") ?? "") as never,
      feedback: text(formData, "feedback"),
    });
    refresh();
    return { success: "Feedback saved" };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function saveDraftAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  try {
    const r = await saveAiOutputAsDraft(actor, text(formData, "jobId") ?? "", {
      captionIndex: Number(text(formData, "captionIndex") ?? 0),
      contentItemId: text(formData, "contentItemId") || undefined,
      channel: text(formData, "channel") || undefined,
    });
    refresh();
    return {
      success: "Saved as a draft. It still needs review and approval",
      redirectTo: `/content/${r.contentItemId}`,
    };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function cancelAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  try {
    await cancelAiJob(actor, text(formData, "jobId") ?? "");
    refresh();
    return { success: "Cancelled" };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function addSourceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireActor();
  try {
    await addApprovedSource(actor, text(formData, "clientId") ?? "", {
      title: text(formData, "title") ?? "",
      body: text(formData, "body") ?? "",
      sourceUrl: text(formData, "sourceUrl") ?? "",
    });
  } catch (error) {
    return toFormState(error);
  }
  refresh();
  return { ok: true, message: "Source approved for AI use" };
}

export async function archiveSourceAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  try {
    await archiveApprovedSource(actor, text(formData, "sourceId") ?? "");
    refresh();
    return { success: "Source removed" };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function setLimitAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireActor();
  try {
    await setAiLimit(actor, text(formData, "clientId") ?? "", {
      monthlyRequests: Number(text(formData, "monthlyRequests")),
      monthlyCostUsd: Number(text(formData, "monthlyCostUsd")),
    });
  } catch (error) {
    return toFormState(error);
  }
  refresh();
  return { ok: true, message: "Limits saved" };
}
