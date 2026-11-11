import { Link2, Globe2, ShieldCheck, Hash } from "lucide-react";
import { getSeoBacklinks } from "@automation/db";
import { LineChart } from "@/components/seo/charts";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireActor } from "@/lib/session";
import { NotConnected } from "../not-connected";

export const metadata = { title: "Backlinks" };

export default async function BacklinksPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const rows = await getSeoBacklinks(actor, id);
  if (rows.length === 0) return <NotConnected what="backlink data" />;
  const latest = rows.at(-1)!;
  const nofollow = latest.raw.nofollow ?? null;
  return (
    <>
      <section
        aria-label="Backlink totals"
        className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatCard
          label="Backlinks"
          value={latest.totalBacklinks.toLocaleString("en-CA")}
          icon={Link2}
          helper={`As of ${latest.day}`}
        />
        <StatCard
          label="Referring domains"
          value={latest.referringDomains.toLocaleString("en-CA")}
          icon={Globe2}
        />
        <StatCard
          label="Dofollow"
          value={latest.raw.dofollow?.toLocaleString("en-CA") ?? "—"}
          icon={ShieldCheck}
        />
        <StatCard label="Nofollow" value={nofollow?.toLocaleString("en-CA") ?? "—"} icon={Hash} />
      </section>
      <Card>
        <CardHeader>
          <CardTitle>Total backlinks over time</CardTitle>
        </CardHeader>
        <CardContent>
          <LineChart
            label="Total backlinks per reading"
            integerAxis
            points={rows.map((r) => ({ x: r.day, y: r.totalBacklinks }))}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            One reading per sync, as SE Ranking reports it. Individual backlinks and lost/new links
            are not imported.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
