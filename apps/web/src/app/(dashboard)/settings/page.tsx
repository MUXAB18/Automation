import { Monitor, Moon, Sun } from "lucide-react";
import { ROLE_TEMPLATES, getAccessMap, listAgenciesWith } from "@automation/db";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getScope } from "@/lib/scope";
import { requireActor } from "@/lib/session";
import { cookies } from "next/headers";
import Link from "next/link";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import { setThemeAction } from "../actions";

export const metadata = { title: "Settings" };

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export default async function SettingsPage() {
  const actor = await requireActor();
  const [scope, access, agencies] = await Promise.all([
    getScope(actor),
    getAccessMap(actor),
    listAgenciesWith(actor, "client.view"),
  ]);
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const roleName = (key: string) =>
    key === "platform_admin"
      ? "Platform admin"
      : (ROLE_TEMPLATES.find((r) => r.key === key)?.name ?? key);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Your account and how this workspace looks for you."
        breadcrumbs={[{ label: "Settings" }]}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <dl className="grid grid-cols-[7rem_1fr] gap-y-3">
              <dt className="text-muted-foreground">Name</dt>
              <dd className="font-medium">{actor.name || "—"}</dd>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="font-medium">{actor.email}</dd>
              <dt className="text-muted-foreground">Access level</dt>
              <dd>
                {actor.isAdmin ? (
                  <Badge tone="primary">Platform admin</Badge>
                ) : (
                  <span className="text-muted-foreground">Agency member</span>
                )}
              </dd>
            </dl>
            <div className="border-t border-border pt-4">
              <p className="mb-2 font-medium">Password</p>
              <p className="mb-3 text-muted-foreground">
                Passwords are changed through an emailed link. Signing out of all devices happens
                automatically when you do.
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href="/forgot-password">Send me a reset link</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={setThemeAction} className="flex flex-wrap gap-2" aria-label="Theme">
              {THEMES.map(({ value, label, icon: Icon }) => (
                <Button
                  key={value}
                  type="submit"
                  name="theme"
                  value={value}
                  variant={theme === value ? "default" : "outline"}
                  aria-pressed={theme === value}
                >
                  <Icon className="size-4" aria-hidden /> {label}
                </Button>
              ))}
            </form>
            <p className="mt-3 text-xs text-muted-foreground">
              System follows your device. The choice is remembered in this browser.
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Your access</CardTitle>
          </CardHeader>
          <CardContent>
            {agencies.length > 0 ? (
              <p className="mb-4 text-sm text-muted-foreground">
                Agencies: {agencies.map((a) => a.name).join(", ")}
              </p>
            ) : null}
            {scope.clients.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                You don&rsquo;t have access to any client yet.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {scope.clients.map((c) => {
                  const roles = [...(access.get(c.id)?.roles ?? [])];
                  return (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                    >
                      <span className="font-medium">{c.name}</span>
                      <span className="flex flex-wrap gap-1">
                        {roles.map((r) => (
                          <Badge key={r} tone="success">
                            {roleName(r)}
                          </Badge>
                        ))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
