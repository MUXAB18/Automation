import { notFound } from "next/navigation";
import { getClientIntegrations } from "@automation/db";
import { getProvider, MOCK_SCENARIOS } from "@automation/integrations";
import { DevelopmentNotice } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mockAllowed, SYNC_MODE_TEXT } from "@/lib/integration-view";
import { getProviders } from "@/lib/providers";
import { getScope } from "@/lib/scope";
import { requireSection } from "@/lib/sections";
import { requireActor } from "@/lib/session";
import { ConnectForm } from "./connect-form";
import { GoogleConnect } from "./google-connect";
import { GhlWizard } from "./ghl-wizard";

export const metadata = { title: "Connect integration" };

export default async function ConnectPage({
  params,
  searchParams,
}: {
  params: Promise<{ provider: string }>;
  searchParams: Promise<{ client?: string; error?: string }>;
}) {
  const actor = await requireActor();
  await requireSection(actor, "integrations");
  const { provider: key } = await params;
  const provider = getProvider(key);
  if (!provider) notFound();
  const scope = await getScope(actor);
  const { client, error } = await searchParams;
  const clientId = client && scope.clients.some((c) => c.id === client) ? client : scope.clientId;
  if (!clientId) notFound();
  // Authorises: integration.view for the page, and the form action re-checks integration.manage.
  const data = await getClientIntegrations(actor, clientId);
  if (!data.canManage) notFound();

  const { registry, publishingEnabled, googleOAuth } = getProviders();
  const live = registry.hasLive(provider.key);
  const mockOk = mockAllowed();
  if (!live && !mockOk) notFound();
  const clientName = scope.clients.find((c) => c.id === clientId)?.name ?? "this client";

  return (
    <>
      <PageHeader
        title={`Connect ${provider.name}`}
        description={`For ${clientName}`}
        breadcrumbs={[{ label: "Integrations", href: "/integrations" }, { label: provider.name }]}
      />
      {!live ? (
        <DevelopmentNotice>
          {provider.name} is not configured on this server: its app credentials are missing from the
          environment (see docs/integrations-gohighlevel.md). You can connect the development mock
          to try the framework: it contacts no one, and everything it syncs is made-up data labelled
          as such.
        </DevelopmentNotice>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {provider.key === "google_analytics_4" || provider.key === "google_search_console" ? (
          <GoogleConnect
            clientId={clientId}
            providerKey={provider.key}
            providerName={provider.name}
            oauthConfigured={googleOAuth !== null}
            mockFields={registry.get(provider.key, "mock").credentialFields.map((f) => ({ ...f }))}
            scenarios={MOCK_SCENARIOS.map((s) => ({ ...s }))}
            mockAllowed={mockOk}
            error={error}
          />
        ) : live && provider.key === "gohighlevel" ? (
          <GhlWizard
            clientId={clientId}
            clientName={clientName}
            publishingEnabled={publishingEnabled}
            error={error}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{live ? "Connection details" : "Development mock"}</CardTitle>
            </CardHeader>
            <CardContent>
              <ConnectForm
                clientId={clientId}
                providerKey={provider.key}
                live={live}
                fields={registry
                  .get(provider.key, live ? "live" : "mock")
                  .credentialFields.map((f) => ({ ...f }))}
                scenarios={MOCK_SCENARIOS.map((s) => ({ ...s }))}
              />
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>About this provider</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              <span className="text-muted-foreground">Sign-in:</span>{" "}
              {provider.authType === "oauth2" ? "OAuth 2.0" : "API key"}
            </p>
            <p>
              <span className="text-muted-foreground">Data arrives:</span>{" "}
              {SYNC_MODE_TEXT[provider.sync.mode]}
            </p>
            <div>
              <p className="text-muted-foreground">Permissions needed</p>
              {provider.requiredScopes.length === 0 ? (
                <p>None assumed yet</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {provider.requiredScopes.map((s) => (
                    <li key={s}>
                      <Badge tone="outline" className="break-all">
                        {s}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
              {provider.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <a
              href={provider.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline"
            >
              Official documentation
            </a>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
