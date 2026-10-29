import Link from "next/link";
import { Users } from "lucide-react";
import { ClientStatus, canCreateClient, listClients } from "@automation/db";
import { DataTable, dash } from "@/components/data-table";
import { ClearFilters, FilterBar, FilterSelect, SearchInput } from "@/components/filters";
import { PageHeader } from "@/components/page-header";
import { ScopeBadge } from "@/components/scope-badge";
import { EmptyState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { getScope } from "@/lib/scope";
import { requireSection } from "@/lib/sections";
import { oneOf, str, type RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const actor = await requireActor();
  await requireSection(actor, "clients");
  const raw = await searchParams;
  const scope = await getScope(actor);
  const q = str(raw.q);
  const status = oneOf(raw.status, Object.values(ClientStatus));
  const clients = await listClients(actor, { search: q, status, clientId: scope.clientId });
  const filtered = Boolean(q || status);

  return (
    <>
      <PageHeader
        title="Clients"
        description="Businesses managed from this dashboard."
        breadcrumbs={[{ label: "Clients" }]}
        badges={<ScopeBadge scope={scope} />}
        actions={
          canCreateClient(actor) ? (
            <Button asChild>
              <Link href="/clients/new">New client</Link>
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <SearchInput placeholder="Search name, slug or website" label="Search clients" />
        <FilterSelect
          name="status"
          label="Filter by status"
          allLabel="All statuses"
          options={Object.values(ClientStatus).map((s) => ({ value: s, label: s }))}
        />
        <ClearFilters names={["q", "status"]} />
      </FilterBar>

      {clients.length === 0 ? (
        <EmptyState
          icon={Users}
          title={filtered ? "No clients match your filters" : "No clients yet"}
          description={
            filtered
              ? "Try a different search or clear the filters."
              : "Clients you can access will be listed here."
          }
          action={
            !filtered && canCreateClient(actor)
              ? { label: "Add a client", href: "/clients/new" }
              : undefined
          }
        />
      ) : (
        <DataTable
          caption="Clients"
          rows={clients}
          rowHref={(c) => `/clients/${c.id}`}
          columns={[
            { key: "name", header: "Client", cell: (c) => c.name },
            {
              key: "status",
              header: "Status",
              cell: (c) => <StatusBadge kind="client" status={c.status} />,
            },
            {
              key: "site",
              header: "Primary website",
              hideOnMobile: true,
              cell: (c) => dash(c.websites.find((w) => w.isPrimary)?.domain),
            },
            {
              key: "report",
              header: "Report",
              hideOnMobile: true,
              cell: (c) => (
                <span className="text-muted-foreground">every {c.reportIntervalDays} days</span>
              ),
            },
          ]}
        />
      )}
    </>
  );
}
