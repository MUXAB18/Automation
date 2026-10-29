import { BarChart3 } from "lucide-react";
import { getAnalytics } from "@automation/db";
import { DataTable, formatDate } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { ScopeBadge } from "@/components/scope-badge";
import { DevelopmentNotice, EmptyState } from "@/components/states";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getScope } from "@/lib/scope";
import { requireSection } from "@/lib/sections";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const actor = await requireActor();
  await requireSection(actor, "analytics");
  const scope = await getScope(actor);
  const data = await getAnalytics(actor, { clientId: scope.clientId });

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Search and traffic performance, per client."
        breadcrumbs={[{ label: "Analytics" }]}
        badges={<ScopeBadge scope={scope} />}
      />
      <DevelopmentNotice>
        Google Search Console and Google Analytics 4 are not connected yet, so there is no live
        data. Charts will appear here once a source has synced.
      </DevelopmentNotice>

      <section aria-label="Summary" className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Data sources"
          value={data.sources.length}
          icon={BarChart3}
          helper="Search Console properties, GA4 properties"
        />
        <StatCard
          label="Stored readings"
          value={data.snapshotCount}
          icon={BarChart3}
          helper="Metric snapshots from provider syncs"
        />
        <StatCard
          label="Last sync"
          value={data.lastRun ? formatDate(data.lastRun.createdAt)! : "Never"}
          icon={BarChart3}
          helper={data.lastRun ? data.lastRun.status : "No sync has run"}
        />
      </section>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Data sources</CardTitle>
        </CardHeader>
        <CardContent>
          {data.sources.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="No data source connected"
              description="Connect Google Search Console or GA4 for a client to start collecting metrics."
              className="border-0 py-8"
            />
          ) : (
            <DataTable
              caption="Analytics data sources"
              rows={data.sources}
              columns={[
                {
                  key: "name",
                  header: "Source",
                  cell: (s) => <span className="font-medium">{s.displayName ?? s.externalId}</span>,
                },
                { key: "client", header: "Client", cell: (s) => s.client.name },
                {
                  key: "kind",
                  header: "Type",
                  hideOnMobile: true,
                  cell: (s) => s.kind.replace(/_/g, " "),
                },
                {
                  key: "status",
                  header: "Account",
                  cell: (s) => (
                    <StatusBadge kind="integration" status={s.integrationAccount.status} />
                  ),
                },
                {
                  key: "synced",
                  header: "Last synced",
                  hideOnMobile: true,
                  cell: (s) => formatDate(s.lastSyncedAt) ?? "Never",
                },
              ]}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Metrics that will be tracked</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-wrap gap-2">
            {data.definitions.map((d) => (
              <li key={d.key}>
                <Badge tone="outline" title={d.key}>
                  {d.name}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
