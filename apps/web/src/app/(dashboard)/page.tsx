import { CheckCircle2, Circle, PauseCircle, Users } from "lucide-react";
import { getOverviewStats } from "@automation/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getActiveClient } from "@/lib/active-client";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Overview" };

const ROADMAP = [
  { label: "Foundation: clients, roles and audit log", done: true },
  { label: "Connect Google Search Console and GA4", done: false },
  { label: "Rankings and traffic dashboards", done: false },
  { label: "Content drafts with approval", done: false },
  { label: "Social publishing and fortnightly reports", done: false },
];

export default async function OverviewPage() {
  const actor = await requireActor();
  const { activeId, options } = await getActiveClient(actor);
  const stats = await getOverviewStats(actor, activeId);
  const scopeName = activeId ? options.find((o) => o.id === activeId)?.name : "All clients";

  const cards = [
    { label: "Clients", value: stats.total, icon: Users, tone: "bg-primary-soft text-primary" },
    {
      label: "Active",
      value: stats.active,
      icon: CheckCircle2,
      tone: "bg-success/15 text-success",
    },
    { label: "Paused", value: stats.paused, icon: PauseCircle, tone: "bg-warning/20 text-warning" },
  ];

  return (
    <>
      <PageHeader
        title={`Hello, ${actor.name.split(" ")[0] || "there"}`}
        description={`Here's where things stand for ${scopeName ?? "your clients"}.`}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map(({ label, value, icon: Icon, tone }) => (
          <Card key={label}>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{label}</CardTitle>
              <span className={`inline-flex size-8 items-center justify-center rounded-lg ${tone}`}>
                <Icon className="size-4" aria-hidden />
              </span>
            </CardHeader>
            <CardContent>
              <p className="text-4xl font-semibold tabular-nums tracking-tight">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center rounded-lg border border-dashed border-border px-6 py-12 text-center">
              <p className="font-medium">No performance data yet</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Rankings and traffic will appear here once Google Search Console and GA4 are
                connected.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Roadmap</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {ROADMAP.map(({ label, done }) => (
                <li key={label} className="flex items-start gap-3 text-sm">
                  {done ? (
                    <CheckCircle2
                      className="mt-0.5 size-4 shrink-0 text-success"
                      aria-label="Done"
                    />
                  ) : (
                    <Circle
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground/50"
                      aria-label="Upcoming"
                    />
                  )}
                  <span className={done ? "" : "text-muted-foreground"}>{label}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
