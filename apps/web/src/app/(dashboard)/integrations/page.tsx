import { Plug } from "lucide-react";
import { getIntegrations } from "@automation/db";
import { DataTable, formatDate } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { ScopeBadge } from "@/components/scope-badge";
import { DevelopmentNotice, EmptyState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getScope } from "@/lib/scope";
import { requireSection } from "@/lib/sections";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Integrations" };

const CATEGORY: Record<string, string> = {
  search: "Search",
  analytics: "Analytics",
  social: "Social networks",
  cms: "Website / CMS",
  seo_data: "SEO data",
  ai: "AI",
  email: "Email",
};

export default async function IntegrationsPage() {
  const actor = await requireActor();
  await requireSection(actor, "integrations");
  const scope = await getScope(actor);
  const data = await getIntegrations(actor, { clientId: scope.clientId });
  const connected = new Set(data.accounts.map((a) => a.integrationId));
  const grouped = new Map<string, typeof data.catalogue>();
  for (const item of data.catalogue)
    grouped.set(item.category, [...(grouped.get(item.category) ?? []), item]);
  const byCategory = [...grouped];

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connected accounts and the services the platform can work with."
        breadcrumbs={[{ label: "Integrations" }]}
        badges={<ScopeBadge scope={scope} />}
      />
      <DevelopmentNotice>
        Connecting accounts is not available yet, so providers below are marked as such. Connected
        accounts will be listed with their status; credentials are never shown.
      </DevelopmentNotice>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Connected accounts</CardTitle>
        </CardHeader>
        <CardContent>
          {data.accounts.length === 0 ? (
            <EmptyState
              icon={Plug}
              title="No accounts connected"
              description="Once a provider is connected for a client it will be listed here with its sync status."
              className="border-0 py-8"
            />
          ) : (
            <DataTable
              caption="Connected accounts"
              rows={data.accounts}
              columns={[
                {
                  key: "name",
                  header: "Account",
                  cell: (a) => (
                    <span className="font-medium">{a.displayName ?? "Unnamed account"}</span>
                  ),
                },
                { key: "client", header: "Client", cell: (a) => a.client.name },
                {
                  key: "status",
                  header: "Status",
                  cell: (a) => <StatusBadge kind="integration" status={a.status} />,
                },
                {
                  key: "synced",
                  header: "Last synced",
                  hideOnMobile: true,
                  cell: (a) => formatDate(a.lastSyncedAt) ?? "Never",
                },
              ]}
            />
          )}
        </CardContent>
      </Card>

      <h2 className="mb-3 text-lg font-semibold">Supported providers</h2>
      <div className="grid gap-6 md:grid-cols-2">
        {byCategory.map(([category, items]) => (
          <Card key={category}>
            <CardHeader>
              <CardTitle>{CATEGORY[category] ?? category}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {items.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                    <div>
                      <p className="font-medium">{i.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {i.authType === "oauth2"
                          ? "Sign in with the provider"
                          : i.authType === "api_key"
                            ? "API key"
                            : "No sign-in"}
                      </p>
                    </div>
                    {connected.has(i.id) ? (
                      <Badge tone="success">Connected</Badge>
                    ) : (
                      <Badge tone="outline">Not available yet</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
