"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ROLE_KEYS,
  addClientMember,
  addWebsite,
  removeClientMember,
  saveBrandGuideline,
  setAccountOwner,
  setClientMemberRoles,
  createClient,
  clientStatusSchema,
  removeWebsite,
  setClientStatus,
  updateClient,
} from "@automation/db";
import { toFormState, type FormState } from "@/lib/action-state";
import { clientInput, text } from "@/lib/form-input";
import { requireActor } from "@/lib/session";

export async function createClientAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireActor();
  let id: string;
  try {
    const client = await createClient(actor, clientInput(formData));
    id = client.id;
  } catch (error) {
    return toFormState(error);
  }
  revalidatePath("/clients");
  redirect(`/clients/${id}`);
}

export async function updateClientAction(
  clientId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  try {
    await updateClient(actor, clientId, clientInput(formData));
  } catch (error) {
    return toFormState(error);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved" };
}

export async function setStatusAction(
  clientId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  const status = clientStatusSchema.safeParse(text(formData, "status"));
  if (!status.success) return { error: "Unknown status" };
  try {
    await setClientStatus(actor, clientId, status.data);
  } catch (error) {
    return toFormState(error);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: `Client is now ${status.data}` };
}

export async function addWebsiteAction(
  clientId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  try {
    await addWebsite(actor, clientId, {
      domain: text(formData, "domain") ?? "",
      isPrimary: formData.get("isPrimary") === "on",
    });
  } catch (error) {
    return toFormState(error);
  }
  revalidatePath(`/clients/${clientId}`);
  return { ok: true, message: "Website added" };
}

export async function removeWebsiteAction(
  clientId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  try {
    await removeWebsite(actor, clientId, text(formData, "websiteId") ?? "");
  } catch (error) {
    return toFormState(error);
  }
  revalidatePath(`/clients/${clientId}`);
  return { ok: true, message: "Website removed" };
}

type ConfirmResult = { error?: string; success?: string };
const toConfirm = (r: FormState): ConfirmResult =>
  r.error ? { error: r.error } : { success: r.message };

/** Same as setStatusAction but shaped for ConfirmDialog (used for Archive). */
export async function setStatusConfirmAction(
  clientId: string,
  formData: FormData,
): Promise<ConfirmResult> {
  return toConfirm(await setStatusAction(clientId, {}, formData));
}

export async function removeWebsiteConfirmAction(
  clientId: string,
  formData: FormData,
): Promise<ConfirmResult> {
  return toConfirm(await removeWebsiteAction(clientId, {}, formData));
}

// ---- Account owner, team, brand ---------------------------------------------------------------------

export async function setOwnerAction(
  clientId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  try {
    await setAccountOwner(actor, clientId, text(formData, "ownerId") || null);
  } catch (error) {
    return toFormState(error);
  }
  revalidatePath(`/clients/${clientId}`, "layout");
  return { ok: true, message: "Account owner updated" };
}

const roleKeys = (formData: FormData) =>
  formData
    .getAll("roleKeys")
    .filter((v): v is (typeof ROLE_KEYS)[number] => ROLE_KEYS.some((k) => k === v));

export async function addMemberAction(
  clientId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  try {
    await addClientMember(actor, {
      clientId,
      userId: text(formData, "userId") ?? "",
      roleKeys: roleKeys(formData),
    });
  } catch (error) {
    return toFormState(error);
  }
  revalidatePath(`/clients/${clientId}`, "layout");
  return { ok: true, message: "Added to the client team" };
}

export async function setMemberRolesAction(
  clientId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  try {
    await setClientMemberRoles(actor, {
      clientId,
      userId: text(formData, "userId") ?? "",
      roleKeys: roleKeys(formData),
    });
  } catch (error) {
    return toFormState(error);
  }
  revalidatePath(`/clients/${clientId}`, "layout");
  return { ok: true, message: "Roles saved" };
}

export async function removeMemberConfirmAction(
  clientId: string,
  formData: FormData,
): Promise<ConfirmResult> {
  const actor = await requireActor();
  try {
    await removeClientMember(actor, clientId, text(formData, "userId") ?? "");
  } catch (error) {
    return { error: toFormState(error).error };
  }
  revalidatePath(`/clients/${clientId}`, "layout");
  return { success: "Removed from the client team" };
}

export async function saveBrandAction(
  clientId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  try {
    await saveBrandGuideline(actor, clientId, {
      toneOfVoice: text(formData, "toneOfVoice"),
      audience: text(formData, "audience"),
      styleNotes: text(formData, "styleNotes"),
      dos: text(formData, "dos") ?? "",
      donts: text(formData, "donts") ?? "",
      bannedTerms: text(formData, "bannedTerms") ?? "",
    });
  } catch (error) {
    return toFormState(error);
  }
  revalidatePath(`/clients/${clientId}`, "layout");
  return { ok: true, message: "Brand guidelines saved as a new version" };
}

/** Archive / restore from the clients table (the client id comes from the row, authorised again here). */
export async function rowStatusConfirmAction(formData: FormData): Promise<ConfirmResult> {
  const actor = await requireActor();
  const status = clientStatusSchema.safeParse(text(formData, "status"));
  if (!status.success) return { error: "Unknown status" };
  try {
    await setClientStatus(actor, text(formData, "clientId") ?? "", status.data);
  } catch (error) {
    return { error: toFormState(error).error };
  }
  revalidatePath("/", "layout");
  return { success: status.data === "archived" ? "Client archived" : "Client restored" };
}
