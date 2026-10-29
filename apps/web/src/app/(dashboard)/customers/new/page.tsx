import { notFound } from "next/navigation";
import { canCreateCustomer } from "@automation/db";
import { PageHeader } from "@/components/page-header";
import { requireActor } from "@/lib/session";
import { createCustomerAction } from "../actions";
import { CustomerForm } from "../customer-form";

export const metadata = { title: "New customer" };

export default async function NewCustomerPage() {
  const actor = await requireActor();
  if (!canCreateCustomer(actor)) notFound();
  return (
    <>
      <PageHeader title="New customer" description="Add a business to manage." />
      <CustomerForm mode="create" action={createCustomerAction} />
    </>
  );
}
