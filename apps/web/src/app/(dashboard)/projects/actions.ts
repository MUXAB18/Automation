"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createProject, setProjectStatus, updateProject } from "@automation/db";
import { toFormState, type FormState } from "@/lib/action-state";
import { projectInput, text } from "@/lib/form-input";
import { requireActor } from "@/lib/session";

export async function createProjectAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  let id: string;
  try {
    const project = await createProject(actor, {
      clientId: text(formData, "clientId") ?? "",
      ...projectInput(formData),
    } as never);
    id = project.id;
  } catch (error) {
    return toFormState(error);
  }
  revalidatePath("/projects");
  redirect(`/projects/${id}`);
}

export async function updateProjectAction(
  projectId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  try {
    await updateProject(actor, projectId, projectInput(formData) as never);
  } catch (error) {
    return toFormState(error);
  }
  revalidatePath("/projects");
  redirect(`/projects/${projectId}`);
}

/** Archive / restore / pause, shaped for ConfirmDialog. The id comes from the row and is authorised again here. */
export async function projectStatusConfirmAction(
  formData: FormData,
): Promise<{ error?: string; success?: string }> {
  const actor = await requireActor();
  const status = text(formData, "status");
  if (status !== "active" && status !== "paused" && status !== "completed" && status !== "archived")
    return { error: "Unknown status" };
  try {
    await setProjectStatus(actor, text(formData, "projectId") ?? "", status);
  } catch (error) {
    return { error: toFormState(error).error };
  }
  revalidatePath("/projects");
  revalidatePath("/", "layout");
  return {
    success:
      status === "archived"
        ? "Project archived"
        : status === "active"
          ? "Project is active"
          : `Project ${status}`,
  };
}
