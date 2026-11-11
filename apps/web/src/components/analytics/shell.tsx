import Link from "next/link";
import { Plug } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ScopeBadge } from "@/components/scope-badge";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { setScopeAction } from "@/app/(dashboard)/actions";
import { PRESETS, resolveRange, type ResolvedRange } from "@/lib/analytics-range";
import { getScope } from "@/lib/scope";
import { requireSection } from "@/lib/sections";
import { requireActor } from "@/lib/session";
import { cn } from "@/lib/utils";

export type AnalyticsParams = {
  range?: string;
  from?: string;
  to?: string;
  ga4?: string;
  gsc?: string;
};

const TABS = [
  { href: "/analytics/dashboard", label: "Dashboard" },
  { href: "/analytics", label: "Overview" },
  { href: "/analytics/traffic", label: "Traffic · Google Analytics" },
  { href: "/analytics/search", label: "Search · Search Console" },
] as const;

const qs = (params: AnalyticsParams, extra: Partial<AnalyticsParams> = {}) => {
  const merged = { ...params, ...extra };
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : "";
};

/**
 * Header, view tabs and date filter shared by the analytics pages. Works without JavaScript: tabs and
 * presets are links, the custom range is a plain GET form. Resolves the client and the date range once.
 */
export async function loadAnalytics(params: AnalyticsParams) {
  const actor = await requireActor();
  await requireSection(actor, "analytics");
  const scope = await getScope(actor);
  const clientId =
    scope.clientId ?? (scope.clients.length === 1 ? scope.clients[0]!.id : undefined);
  return { actor, scope, clientId, range: resolveRange(params) };
}

export function AnalyticsShell({
  path,
  params,
  range,
  scope,
  clientId,
  children,
  sources,
  allowAllClients = false,
}: {
  path: string;
  params: AnalyticsParams;
  range: ResolvedRange;
  scope: Awaited<ReturnType<typeof getScope>>;
  clientId: string | undefined;
  children: React.ReactNode;
  /** The page works across all clients (agency dashboard): no client has to be chosen first. */
  allowAllClients?: boolean;
  /** Property pickers, one per source kind with more than one choice. */
  sources?: {
    param: "ga4" | "gsc";
    label: string;
    options: { id: string; name: string }[];
    selected: string | null;
  }[];
}) {
  const header = (
    <PageHeader
      title="Analytics"
      description="Website traffic from Google Analytics and search performance from Search Console, kept apart because they measure different things."
      breadcrumbs={[{ label: "Analytics" }]}
      badges={<ScopeBadge scope={scope} />}
    />
  );
  if (!clientId && !allowAllClients) {
    return (
      <>
        {header}
        <Card>
          <CardHeader>
            <CardTitle>Choose a client</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              Analytics belong to one client. Pick the client whose numbers you want to see.
            </p>
            {scope.clients.length === 0 ? (
              <EmptyState
                icon={Plug}
                title="No clients yet"
                description="Add a client, then connect its Google accounts."
              />
            ) : (
              <ul className="divide-y divide-border">
                {scope.clients.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                    <span className="font-medium">{c.name}</span>
                    <form action={setScopeAction}>
                      <input type="hidden" name="clientId" value={c.id} />
                      <Button type="submit" size="sm" variant="outline">
                        Open analytics
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
  const pill = "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors";
  return (
    <>
      {header}
      <nav
        aria-label="Analytics views"
        className="mb-5 flex flex-wrap gap-1 border-b border-border"
      >
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={`${t.href}${qs(params)}`}
            aria-current={t.href === path ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors",
              t.href === path
                ? "border-primary font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div role="search" aria-label="Date range" className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-full bg-card p-1 shadow-card">
          {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((p) => (
            <Link
              key={p}
              href={`${path}${qs({ ...params, from: undefined, to: undefined }, { range: p })}`}
              aria-current={range.preset === p ? "true" : undefined}
              className={cn(
                pill,
                range.preset === p
                  ? "bg-primary text-white shadow"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Last {PRESETS[p]} days
            </Link>
          ))}
        </div>
        <form method="get" action={path} className="flex flex-wrap items-center gap-2 text-xs">
          {params.ga4 ? <input type="hidden" name="ga4" value={params.ga4} /> : null}
          {params.gsc ? <input type="hidden" name="gsc" value={params.gsc} /> : null}
          <label className="flex items-center gap-1.5 text-muted-foreground">
            From
            <input
              type="date"
              name="from"
              defaultValue={range.from}
              max={range.to}
              className="h-9 rounded-lg border border-border bg-card px-2 text-foreground"
            />
          </label>
          <label className="flex items-center gap-1.5 text-muted-foreground">
            To
            <input
              type="date"
              name="to"
              defaultValue={range.to}
              className="h-9 rounded-lg border border-border bg-card px-2 text-foreground"
            />
          </label>
          <Button type="submit" size="sm" variant="outline">
            Apply
          </Button>
        </form>
        <p className="ml-auto text-xs text-muted-foreground">
          {range.from} to {range.to} · {range.days} days · newest day is yesterday
        </p>
      </div>
      {sources
        ?.filter((s) => s.options.length > 1)
        .map((s) => (
          <div key={s.param} className="mb-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">{s.label}:</span>
            {s.options.map((o) => (
              <Link
                key={o.id}
                href={`${path}${qs(params, { [s.param]: o.id })}`}
                aria-current={s.selected === o.id ? "true" : undefined}
                className={cn(
                  pill,
                  "border border-border",
                  s.selected === o.id
                    ? "bg-primary-soft text-primary"
                    : "bg-card text-muted-foreground",
                )}
              >
                {o.name}
              </Link>
            ))}
          </div>
        ))}
      {children}
    </>
  );
}
