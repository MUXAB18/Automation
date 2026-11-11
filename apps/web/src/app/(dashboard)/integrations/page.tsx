import Link from "next/link";
import { Plug } from "lucide-react";
import { getClientIntegrations } from "@automation/db";
import { PROVIDERS } from "@automation/integrations";
import { FormMessage } from "@/components/form-message";
import { setScopeAction } from "@/app/(dashboard)/actions";
import { getProviders } from "@/lib/providers";
import { PageHeader } from "@/components/page-header";
import { ScopeBadge } from "@/components/scope-badge";
import { EmptyState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/components/data-table";
import { mockAllowed } from "@/lib/integration-view";
import { getScope } from "@/lib/scope";
import { requireSection } from "@/lib/sections";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const { registry, googleOAuth } = getProviders();
  const actor = await requireActor();
  await requireSection(actor, "integrations");
  const scope = await getScope(actor);

  const header = (
    <PageHeader
      title="Integrations"
      description="Connect each client's accounts. Credentials are encrypted and never shown again after saving."
      breadcrumbs={[{ label: "Integrations" }]}
      badges={<ScopeBadge scope={scope} />}
    />
  );

  // One client in reach: no choice to make.
  const clientId =
    scope.clientId ?? (scope.clients.length === 1 ? scope.clients[0]!.id : undefined);

  if (!clientId) {
    return (
      <>
        {header}
        <Card>
          <CardHeader>
            <CardTitle>Choose a client</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              Integrations belong to one client. Pick the client whose connections you want to
              manage.
            </p>
            {scope.clients.length === 0 ? (
              <EmptyState
                icon={Plug}
                title="No clients yet"
                description="Add a client first, then connect its accounts here."
              />
            ) : (
              <ul className="divide-y divide-border">
                {scope.clients.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                    <span className="font-medium">{c.name}</span>
                    <form action={setScopeAction}>
                      <input type="hidden" name="clientId" value={c.id} />
                      <Button type="submit" size="sm" variant="outline">
                        Manage integrations
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </>
    );
  }

  const data = await getClientIntegrations(actor, clientId);
  const framework = new Set(PROVIDERS.map((p) => p.key));
  const others = data.catalogue.filter((c) => !framework.has(c.key));

  return (
    <>
      {header}
      <FormMessage error={error} />
      <div className="grid gap-4 lg:grid-cols-2">
        {PROVIDERS.map((provider) => {
          const accounts = data.accounts.filter((a) => a.providerKey === provider.key);
          return (
            <Card key={provider.key}>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle>{provider.name}</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {provider.authType === "oauth2" ? "Sign in with the provider" : "API key"} ·{" "}
                    {provider.sync.mode === "polling"
                      ? "scheduled sync"
                      : "scheduled sync + webhooks"}
                  </p>
                </div>
                {provider.key === "gohighlevel" && !registry.hasLive(provider.key) ? (
                  <Badge tone="warning">Needs GoHighLevel app credentials</Badge>
                ) : provider.authType === "oauth2" &&
                  provider.key.startsWith("google") &&
                  !googleOAuth ? (
                  <Badge tone="warning">Google sign-in not configured</Badge>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-3">
                {accounts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Not connected.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {accounts.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center justify-between gap-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <Link
                            href={`/integrations/${a.id}`}
                            className="font-medium hover:underline"
                          >
                            {a.displayName ?? a.externalAccountId}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            Last synced {formatDate(a.lastSyncedAt) ?? "never"}
                            {a.activeRun ? ` · sync ${a.activeRun}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {a.isMock ? <Badge tone="warning">Development mock</Badge> : null}
                          <StatusBadge kind="integration" status={a.status} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {data.canManage && (registry.hasLive(provider.key) || mockAllowed()) ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/integrations/connect/${provider.key}?client=${clientId}`}>
                      {accounts.length ? "Connect another / reconnect" : "Set up"}
                    </Link>
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {others.length > 0 ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Other providers</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {others.map((i) => (
                <li key={i.id} className="flex items-center justify-between py-2.5">
                  <span>{i.name}</span>
                  <Badge tone="outline">Not available yet</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
