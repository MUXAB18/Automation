import { getSeoAudits } from "@automation/db";
import { DataTable, dash, formatDate } from "@/components/data-table";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, AlertOctagon, AlertTriangle, Info } from "lucide-react";
import { requireActor } from "@/lib/session";
import { NotConnected } from "../not-connected";

export const metadata = { title: "Site audit" };

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const audits = await getSeoAudits(actor, id);
  if (audits.length === 0) return <NotConnected what="site audits" />;
  const latest = audits[0]!;
  return (
    <>
      <section aria-label="Latest audit" className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Health score"
          value={latest.healthScore ?? "—"}
          icon={ShieldCheck}
          tone={latest.healthScore !== null && latest.healthScore >= 80 ? "success" : "warning"}
          helper={`${latest.pagesCrawled} pages crawled`}
        />
        <StatCard
          label="Errors"
          value={latest.summary.errors ?? "—"}
          icon={AlertOctagon}
          tone="destructive"
          helper="Checks reported as errors"
        />
        <StatCard
          label="Warnings"
          value={latest.summary.warnings ?? "—"}
          icon={AlertTriangle}
          tone="warning"
        />
        <StatCard label="Notices" value={latest.summary.notices ?? "—"} icon={Info} />
      </section>
      <p className="mb-3 text-xs text-muted-foreground">
        Latest audit{" "}
        {latest.finishedAt ? `finished ${formatDate(latest.finishedAt)}` : "has not finished"}.
        Counts are exactly what SE Ranking reported for that audit.
      </p>
      <DataTable
        caption="Audit history"
        rows={audits}
        columns={[
          { key: "when", header: "Audit", cell: (a) => formatDate(a.finishedAt ?? a.createdAt) },
          {
            key: "status",
            header: "Status",
            cell: (a) => (
              <StatusBadge
                kind="run"
                status={
                  a.status === "completed"
                    ? "succeeded"
                    : a.status === "running"
                      ? "running"
                      : a.status === "failed"
                        ? "failed"
                        : "queued"
                }
              />
            ),
          },
          { key: "score", header: "Score", align: "right", cell: (a) => dash(a.healthScore) },
          {
            key: "errors",
            header: "Errors",
            align: "right",
            hideOnMobile: true,
            cell: (a) => dash(a.summary.errors),
          },
          {
            key: "warn",
            header: "Warnings",
            align: "right",
            hideOnMobile: true,
            cell: (a) => dash(a.summary.warnings),
          },
          {
            key: "pages",
            header: "Pages",
            align: "right",
            hideOnMobile: true,
            cell: (a) => a.pagesCrawled,
          },
          {
            key: "src",
            header: "Source",
            hideOnMobile: true,
            cell: (a) =>
              a.externalSource === "se_ranking" ? <Badge tone="outline">SE Ranking</Badge> : "—",
          },
        ]}
      />
    </>
  );
}
