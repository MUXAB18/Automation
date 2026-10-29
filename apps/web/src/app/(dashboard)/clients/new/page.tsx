import { notFound } from "next/navigation";
import { canCreateClient } from "@automation/db";
import { PageHeader } from "@/components/page-header";
import { requireActor } from "@/lib/session";
import { createClientAction } from "../actions";
import { ClientForm } from "../client-form";

export const metadata = { title: "New client" };

export default async function NewClientPage() {
  const actor = await requireActor();
  if (!canCreateClient(actor)) notFound();
  return (
    <>
      <PageHeader title="New client" description="Add a business to manage." />
      <ClientForm mode="create" action={createClientAction} />
    </>
  );
}
