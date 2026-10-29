"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addWebsite,
  createCustomer,
  customerStatusSchema,
  removeWebsite,
  setCustomerStatus,
  updateCustomer,
} from "@automation/db";
import { toFormState, type FormState } from "@/lib/action-state";
import { requireActor } from "@/lib/session";

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
};

export async function createCustomerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireActor();
  let id: string;
  try {
    const customer = await createCustomer(actor, {
      name: text(formData, "name") ?? "",
      slug: text(formData, "slug"),
      reportEmail: text(formData, "reportEmail"),
      reportIntervalDays: text(formData, "reportIntervalDays"),
      primaryDomain: text(formData, "primaryDomain"),
    });
    id = customer.id;
  } catch (error) {
    return toFormState(error);
  }
  revalidatePath("/customers");
  redirect(`/customers/${id}`);
}

export async function updateCustomerAction(
  customerId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  try {
    await updateCustomer(actor, customerId, {
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
  customerId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  const status = customerStatusSchema.safeParse(text(formData, "status"));
  if (!status.success) return { error: "Unknown status" };
  try {
    await setCustomerStatus(actor, customerId, status.data);
  } catch (error) {
    return toFormState(error);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: `Customer is now ${status.data}` };
}

export async function addWebsiteAction(
  customerId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  try {
    await addWebsite(actor, customerId, {
      domain: text(formData, "domain") ?? "",
      isPrimary: formData.get("isPrimary") === "on",
    });
  } catch (error) {
    return toFormState(error);
  }
  revalidatePath(`/customers/${customerId}`);
  return { ok: true, message: "Website added" };
}

export async function removeWebsiteAction(
  customerId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  try {
    await removeWebsite(actor, customerId, text(formData, "websiteId") ?? "");
  } catch (error) {
    return toFormState(error);
  }
  revalidatePath(`/customers/${customerId}`);
  return { ok: true, message: "Website removed" };
}
