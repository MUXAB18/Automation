import { notFound } from "next/navigation";
import { NotFoundError, can } from "@automation/db";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { TabsNav } from "@/components/tabs-nav";
import { loadClient } from "@/lib/cached";
import { requireActor } from "@/lib/session";
import { setStatusAction, setStatusConfirmAction } from "../actions";
import { StatusControls } from "../status-controls";

/** Header and tabs shared by the client's pages. The id is authorised on every request (getClient). */
export default async function ClientLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const actor = await requireActor();
  const { id } = await params;
  let data;
  try {
    data = await loadClient(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { client, access } = data;
  const base = `/clients/${id}`;
  return (
    <>
      <PageHeader
        title={client.name}
        description={
          [client.industry, client.websites.find((w) => w.isPrimary)?.domain]
            .filter(Boolean)
            .join(" · ") || client.slug
        }
        breadcrumbs={[{ label: "Clients", href: "/clients" }, { label: client.name }]}
        badges={<StatusBadge kind="client" status={client.status} />}
        actions={
          can(access, "client.status") ? (
            <StatusControls
              status={client.status}
              clientName={client.name}
              action={setStatusAction.bind(null, id)}
              confirmAction={setStatusConfirmAction.bind(null, id)}
            />
          ) : null
        }
      />
      <TabsNav
        label="Client sections"
        tabs={[
          { href: base, label: "Overview", exact: true },
          { href: `${base}/team`, label: "Team" },
          { href: `${base}/brand`, label: "Brand guidelines" },
          { href: `${base}/edit`, label: "Settings" },
        ]}
      />
      {children}
    </>
  );
}
