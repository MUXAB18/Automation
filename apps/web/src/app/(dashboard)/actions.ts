"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ACTIVE_CUSTOMER_COOKIE, ALL_CUSTOMERS, getActiveCustomer } from "@/lib/active-customer";
import { requireActor } from "@/lib/session";

export async function setActiveCustomerAction(formData: FormData) {
  const actor = await requireActor();
  const value = formData.get("customerId");
  const { options } = await getActiveCustomer(actor);

  // Only accept values the actor may actually use.
  const allowed = typeof value === "string" && (options.some((o) => o.id === value) || (actor.isAdmin && value === ALL_CUSTOMERS));
  if (!allowed) return;

  (await cookies()).set(ACTIVE_CUSTOMER_COOKIE, value, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}
