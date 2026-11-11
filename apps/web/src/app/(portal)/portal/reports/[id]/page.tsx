import Link from "next/link";
import { getReport } from "@automation/db";
import { PageHeader } from "@/components/page-header";
import { ReportDocument } from "@/components/reports/report-document";
import { Button } from "@/components/ui/button";
import { orNotFound } from "@/lib/guard";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Report" };

export default async function PortalReport({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  // getReport returns only approved or delivered reports of the person's own client; anything else is "not found".
  const { view } = await orNotFound(getReport(actor, id));
  return (
    <>
      <PageHeader
        title={view.title}
        description={`${view.periodStart} to ${view.periodEnd}`}
        breadcrumbs={[{ label: "Overview", href: "/portal" }, { label: "Report" }]}
        actions={
          <Button variant="outline" asChild>
            <a href={`/reports/${id}/pdf`}>Download PDF</a>
          </Button>
        }
      />
      <ReportDocument view={view} />
      <p className="mt-6 text-xs">
        <Link href="/portal" className="text-primary underline">
          Back to overview
        </Link>
      </p>
    </>
  );
}
