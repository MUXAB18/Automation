import { CheckCircle2, CircleSlash } from "lucide-react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConnectForm } from "./connect-form";
import { ServiceAccountForm } from "./service-account-form";

type Field = {
  name: string;
  label: string;
  secret: boolean;
  required: boolean;
  help?: string;
  options?: readonly { value: string; label: string }[];
};

/** Three ways to connect Google, honestly labelled: sign in, service account, development mock. */
export function GoogleConnect({
  clientId,
  providerKey,
  providerName,
  oauthConfigured,
  mockFields,
  scenarios,
  mockAllowed,
  error,
}: {
  clientId: string;
  providerKey: string;
  providerName: string;
  oauthConfigured: boolean;
  mockFields: Field[];
  scenarios: { value: string; label: string }[];
  mockAllowed: boolean;
  error?: string;
}) {
  const where =
    providerKey === "google_analytics_4"
      ? "the property's Access management (Viewer role)"
      : "Search Console > Settings > Users and permissions (any level)";
  return (
    <div className="space-y-5">
      <FormMessage error={error} />
      <Card>
        <CardHeader>
          <CardTitle>Sign in with Google</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Read-only access, granted by someone who can see the {providerName} data. Only a
            long-lived refresh token is stored, encrypted.
          </p>
          {oauthConfigured ? (
            <form method="get" action="/api/integrations/google/start">
              <input type="hidden" name="client" value={clientId} />
              <input type="hidden" name="provider" value={providerKey} />
              <Button type="submit">
                <CheckCircle2 className="size-4" aria-hidden /> Continue with Google
              </Button>
            </form>
          ) : (
            <p className="flex items-start gap-2 text-muted-foreground">
              <CircleSlash className="mt-0.5 size-4 shrink-0" aria-hidden /> Not configured on this
              server (needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI). Use a
              service account instead.
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Service account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            No personal sign-in needed. Add the service account&apos;s email address as a user in{" "}
            {where}, then paste its key here.
          </p>
          <ServiceAccountForm clientId={clientId} providerKey={providerKey} />
        </CardContent>
      </Card>
      {mockAllowed ? (
        <Card className="border-warning/40">
          <CardHeader>
            <CardTitle>Development mock</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">
              Connects a simulated {providerName}: no Google service is contacted and every number
              is made up and labelled as such.
            </p>
            <ConnectForm
              clientId={clientId}
              providerKey={providerKey}
              live={false}
              fields={mockFields}
              scenarios={scenarios}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
