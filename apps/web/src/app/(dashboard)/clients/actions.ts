"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addWebsite,
  createClient,
  clientStatusSchema,
  removeWebsite,
  setClientStatus,
  updateClient,
} from "@automation/db";
import { toFormState, type FormState } from "@/lib/action-state";
import { requireActor } from "@/lib/session";

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
};

export async function createClientAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireActor();
  let id: string;
  try {
    const client = await createClient(actor, {
      name: text(formData, "name") ?? "",
      slug: text(formData, "slug"),
      reportEmail: text(formData, "reportEmail"),
      reportIntervalDays: text(formData, "reportIntervalDays"),
      primaryDomain: text(formData, "primaryDomain"),
    });
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
    await updateClient(actor, clientId, {
      name: text(formData, "name") ?? "",
      slug: text(formData, "slug") ?? "",
      reportEmail: text(formData, "reportEmail"),
      reportIntervalDays: text(formData, "reportIntervalDays"),
    });
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
