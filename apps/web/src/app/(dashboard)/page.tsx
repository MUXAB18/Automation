import { getOverviewStats } from "@automation/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getActiveCustomer } from "@/lib/active-customer";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const actor = await requireActor();
  const { activeId, options } = await getActiveCustomer(actor);
  const stats = await getOverviewStats(actor, activeId);
  const scopeName = activeId ? options.find((o) => o.id === activeId)?.name : "All customers";

  const cards = [
    { label: "Customers", value: stats.total },
    { label: "Active", value: stats.active },
    { label: "Paused", value: stats.paused },
  ];

  return (
    <>
      <PageHeader title="Overview" description={`Showing: ${scopeName ?? "your customers"}`} />
      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader>
              <CardTitle>{card.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tabular-nums">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-6 rounded-lg border border-dashed border-border p-10 text-center">
        <p className="font-medium">No performance data yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Rankings, traffic, content and reports will appear here once those features are connected.
        </p>
      </div>
    </>
  );
}
