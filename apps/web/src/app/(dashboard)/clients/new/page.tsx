import { notFound } from "next/navigation";
import { canCreateClients, listAgenciesWith, listTimeZones } from "@automation/db";
import { PageHeader } from "@/components/page-header";
import { orderedTimeZones } from "@/lib/time-zones";
import { requireActor } from "@/lib/session";
import { createClientAction } from "../actions";
import { ClientForm } from "../client-form";

export const metadata = { title: "New client" };

export default async function NewClientPage() {
  const actor = await requireActor();
  if (!(await canCreateClients(actor))) notFound();
  const agencies = await listAgenciesWith(actor, "client.create");
  return (
    <>
      <PageHeader
        title="New client"
        description="Add a business to manage. You become its account owner; you can change that later."
        breadcrumbs={[{ label: "Clients", href: "/clients" }, { label: "New client" }]}
      />
      <ClientForm
        mode="create"
        action={createClientAction}
        timeZones={orderedTimeZones(listTimeZones())}
        agencies={agencies}
      />
    </>
  );
}
