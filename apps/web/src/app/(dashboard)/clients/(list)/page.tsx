import Link from "next/link";
import { Users } from "lucide-react";
import { ClientStatus, canCreateClients, searchClients } from "@automation/db";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, dash } from "@/components/data-table";
import { ClearFilters, FilterBar, FilterSelect, SearchInput } from "@/components/filters";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { ScopeBadge } from "@/components/scope-badge";
import { EmptyState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { getScope } from "@/lib/scope";
import { requireSection } from "@/lib/sections";
import { flat, oneOf, page, str, type RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";
import { rowStatusConfirmAction } from "../actions";

export const metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const actor = await requireActor();
  await requireSection(actor, "clients");
  const raw = await searchParams;
  const scope = await getScope(actor);
  const q = str(raw.q);
  const status = oneOf(raw.status, Object.values(ClientStatus));
  const owner = oneOf(raw.owner, ["me"] as const);
  const sort = oneOf(raw.sort, ["name", "recent"] as const);
  const [result, canCreate] = await Promise.all([
    searchClients(actor, {
      q,
      status,
      owner,
      sort,
      clientId: scope.clientId,
      page: page(raw.page),
    }),
    canCreateClients(actor),
  ]);
  const filtered = Boolean(q || status || owner);

  return (
    <>
      <PageHeader
        title="Clients"
        description="Businesses managed from this dashboard."
        breadcrumbs={[{ label: "Clients" }]}
        badges={<ScopeBadge scope={scope} />}
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/clients/new">New client</Link>
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <SearchInput placeholder="Search name, industry or website" label="Search clients" />
        <FilterSelect
          name="status"
          label="Filter by status"
          allLabel="All statuses"
          options={Object.values(ClientStatus).map((s) => ({ value: s, label: s }))}
        />
        <FilterSelect
          name="owner"
          label="Filter by account owner"
          allLabel="Any owner"
          options={[{ value: "me", label: "I am the owner" }]}
        />
        <FilterSelect
          name="sort"
          label="Sort"
          allLabel="Sort: name"
          options={[{ value: "recent", label: "Recently updated" }]}
        />
        <ClearFilters names={["q", "status", "owner", "sort"]} />
      </FilterBar>

      {result.total === 0 ? (
        <EmptyState
          icon={Users}
          title={filtered ? "No clients match your filters" : "No clients yet"}
          description={
            filtered
              ? "Try a different search or clear the filters."
              : "Clients you can access will be listed here."
          }
          action={
            !filtered && canCreate ? { label: "Add a client", href: "/clients/new" } : undefined
          }
        />
      ) : (
        <>
          <DataTable
            caption="Clients"
            rows={result.rows}
            rowHref={(c) => `/clients/${c.id}`}
            columns={[
              {
                key: "name",
                header: "Client",
                cell: (c) => (
                  <span>
                    {c.name}
                    {c.industry ? (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {c.industry}
                      </span>
                    ) : null}
                  </span>
                ),
              },
              {
                key: "status",
                header: "Status",
                cell: (c) => <StatusBadge kind="client" status={c.status} />,
              },
              {
                key: "owner",
                header: "Account owner",
                hideOnMobile: true,
                cell: (c) => dash(c.accountOwner?.name),
              },
              {
                key: "site",
                header: "Website",
                hideOnMobile: true,
                cell: (c) => dash(c.websites[0]?.domain),
              },
              {
                key: "projects",
                header: "Active projects",
                align: "right",
                hideOnMobile: true,
                cell: (c) => c._count.projects,
              },
              {
                key: "actions",
                header: "",
                align: "right",
                cell: (c) =>
                  c.canArchive ? (
                    <ConfirmDialog
                      triggerLabel={c.status === "archived" ? "Restore" : "Archive"}
                      triggerVariant="ghost"
                      title={c.status === "archived" ? `Restore ${c.name}?` : `Archive ${c.name}?`}
                      description={
                        c.status === "archived"
                          ? "The client becomes active again and returns to selectors and scheduled jobs."
                          : "Archived clients are hidden from selectors and skipped by scheduled jobs. Their data is kept and you can restore the client any time."
                      }
                      confirmLabel={c.status === "archived" ? "Restore client" : "Archive client"}
                      destructive={c.status !== "archived"}
                      action={rowStatusConfirmAction}
                      fields={{
                        clientId: c.id,
                        status: c.status === "archived" ? "active" : "archived",
                      }}
                    />
                  ) : null,
              },
            ]}
          />
          <Pagination
            page={result.page}
            pageCount={result.pageCount}
            total={result.total}
            searchParams={flat(raw)}
            basePath="/clients"
          />
        </>
      )}
    </>
  );
}
