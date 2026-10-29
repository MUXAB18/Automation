import "server-only";
import { cookies } from "next/headers";
import { listCustomers } from "@automation/db";
import type { SessionActor } from "./session";

export const ACTIVE_CUSTOMER_COOKIE = "active_customer";
export const ALL_CUSTOMERS = "all";

export type ActiveCustomerState = {
  options: { id: string; name: string; status: string }[];
  /** The customer the whole app is scoped to; undefined means all customers (admins only). */
  activeId: string | undefined;
};

/**
 * Resolve the customer switcher state. The cookie is only a preference: it is
 * checked against the customers the actor can actually access on every request.
 */
export async function getActiveCustomer(actor: SessionActor): Promise<ActiveCustomerState> {
  const customers = await listCustomers(actor);
  const options = customers.map(({ id, name, status }) => ({ id, name, status }));
  const saved = (await cookies()).get(ACTIVE_CUSTOMER_COOKIE)?.value;

  if (saved && options.some((o) => o.id === saved)) return { options, activeId: saved };
  if (actor.isAdmin) return { options, activeId: undefined };
  // Members and viewers always work inside one of their customers.
  return { options, activeId: options[0]?.id };
}
