import { getSeoCompetitors } from "@automation/db";
import { DataTable, dash, formatDate } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { requireActor } from "@/lib/session";
import { NotConnected } from "../not-connected";

export const metadata = { title: "Competitors" };

export default async function CompetitorsPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const rows = await getSeoCompetitors(actor, id);
  if (rows.length === 0) return <NotConnected what="competitors" />;
  return (
    <>
      <DataTable
        caption="Competitors"
        rows={rows}
        columns={[
          {
            key: "domain",
            header: "Domain",
            cell: (c) => <span className="font-medium">{c.domain}</span>,
          },
          { key: "name", header: "Name", cell: (c) => dash(c.name) },
          {
            key: "trust",
            header: "Domain trust",
            align: "right",
            cell: (c) => dash(c.providerData.domainTrust),
          },
          {
            key: "read",
            header: "Read",
            hideOnMobile: true,
            cell: (c) =>
              c.providerData.readAt ? formatDate(new Date(c.providerData.readAt)) : "—",
          },
          {
            key: "src",
            header: "Source",
            hideOnMobile: true,
            cell: (c) =>
              c.externalSource === "se_ranking" ? (
                <Badge tone="outline">SE Ranking</Badge>
              ) : (
                "Added by hand"
              ),
          },
        ]}
      />
      <p className="mt-3 text-xs text-muted-foreground">
        Competitor rankings are not imported yet; only the competitor list and domain trust are.
      </p>
    </>
  );
}
