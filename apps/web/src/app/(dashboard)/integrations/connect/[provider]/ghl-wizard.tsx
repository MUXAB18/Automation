import { CheckCircle2, CircleSlash } from "lucide-react";
import { GHL_RESOURCE_SCOPES } from "@automation/integrations";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const FEATURES: { resource: string; label: string; gets: string }[] = [
  { resource: "contacts", label: "Contacts", gets: "Name, email, phone, source and tags" },
  {
    resource: "opportunities",
    label: "Opportunities and pipelines",
    gets: "Deals, value, stage and status",
  },
  {
    resource: "conversations",
    label: "Conversations",
    gets: "Metadata only (never message text); the latest conversations",
  },
  { resource: "campaigns", label: "Campaigns", gets: "Names and status" },
  { resource: "workflows", label: "Workflows", gets: "Names, status and version" },
  {
    resource: "social_accounts",
    label: "Social accounts",
    gets: "Connected profiles you can publish to",
  },
  { resource: "social_posts", label: "Social posts", gets: "Posts from the last 90 days" },
  { resource: "social_statistics", label: "Social performance", gets: "A 7-day total per sync" },
];

/** Step-by-step connection to a single GoHighLevel location. Server-rendered; the only form is a plain GET. */
export function GhlWizard({
  clientId,
  clientName,
  publishingEnabled,
  error,
}: {
  clientId: string;
  clientName: string;
  publishingEnabled: boolean;
  error?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect a GoHighLevel location</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 text-sm">
        <FormMessage error={error} />
        <ol className="space-y-5">
          <li>
            <p className="font-medium">1. What you are connecting</p>
            <p className="mt-1 text-muted-foreground">
              One GoHighLevel location (sub-account) for {clientName}. Install the app on the
              location itself: an agency-wide install cannot be used.
            </p>
          </li>
          <li>
            <p className="font-medium">2. What the platform will ask to read</p>
            <p className="mt-1 text-muted-foreground">
              Each feature needs its own permission. Anything you decline on GoHighLevel&apos;s
              consent screen is shown afterwards as unsupported, and everything else keeps working.
            </p>
            <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
              {FEATURES.map((f) => (
                <li
                  key={f.resource}
                  className="flex flex-wrap items-start justify-between gap-2 px-3 py-2"
                >
                  <div>
                    <p className="font-medium">{f.label}</p>
                    <p className="text-xs text-muted-foreground">{f.gets}</p>
                  </div>
                  <code className="text-xs text-muted-foreground">
                    {GHL_RESOURCE_SCOPES[f.resource]?.join(", ")}
                  </code>
                </li>
              ))}
            </ul>
          </li>
          <li>
            <p className="font-medium">3. Posting (optional)</p>
            <form
              method="get"
              action="/api/integrations/gohighlevel/start"
              className="mt-2 space-y-4"
            >
              <input type="hidden" name="client" value={clientId} />
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  name="posting"
                  value="1"
                  disabled={!publishingEnabled}
                  className="mt-1 size-4"
                />
                <span>
                  Also allow publishing approved posts (<code>socialplanner/post.write</code>)
                  {!publishingEnabled ? (
                    <span className="mt-1 flex items-center gap-1.5 text-muted-foreground">
                      <CircleSlash className="size-3.5" aria-hidden /> Switched off on this server
                      until posting has been tested in a sandbox location.
                    </span>
                  ) : (
                    <span className="mt-1 block text-muted-foreground">
                      Only content with an approval for its current version is ever posted.
                    </span>
                  )}
                </span>
              </label>
              <div>
                <p className="mb-2 font-medium">4. Sign in to GoHighLevel</p>
                <Button type="submit">Continue to GoHighLevel</Button>
                <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  You return here automatically. The connection is tested before anything is saved,
                  and the tokens are encrypted and never shown.
                </p>
              </div>
            </form>
          </li>
        </ol>
      </CardContent>
    </Card>
  );
}
