import Link from "next/link";
import { CustomerStatus, canCreateCustomer, listCustomers } from "@automation/db";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getActiveCustomer } from "@/lib/active-customer";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Customers" };

type SearchParams = Promise<{ q?: string; status?: string }>;

export default async function CustomersPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireActor();
  const { q, status } = await searchParams;
  const parsedStatus = Object.values(CustomerStatus).find((s) => s === status);
  const { activeId, options } = await getActiveCustomer(actor);
  const customers = await listCustomers(actor, {
    search: q,
    status: parsedStatus,
    customerId: activeId,
  });

  return (
    <>
      <PageHeader
        title="Customers"
        description="Businesses managed from this dashboard."
        actions={
          canCreateCustomer(actor) ? (
            <Button asChild>
              <Link href="/customers/new">New customer</Link>
            </Button>
          ) : null
        }
      />

      {activeId ? (
        <p className="mb-4 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          Showing {options.find((o) => o.id === activeId)?.name ?? "the selected customer"} only.
          Use the customer switcher in the header to change this
          {actor.isAdmin ? ' or choose "All customers"' : ""}.
        </p>
      ) : null}

      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search name, slug or website"
          aria-label="Search customers"
          className="max-w-xs"
        />
        <select
          name="status"
          defaultValue={parsedStatus ?? ""}
          aria-label="Filter by status"
          className="h-9 rounded-md border border-border bg-card px-3 text-sm"
        >
          <option value="">All statuses</option>
          {Object.values(CustomerStatus).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {customers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          {q || parsedStatus ? "No customers match your search." : "No customers yet."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Customer</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Primary website</th>
                <th className="px-4 py-2.5 font-medium">Report</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {customers.map((c) => (
                <tr key={c.id} className="hover:bg-muted/50">
                  <td className="px-4 py-2.5">
                    <Link href={`/customers/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{c.slug}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-2.5">
                    {c.websites.find((w) => w.isPrimary)?.domain ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    every {c.reportIntervalDays} days
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
