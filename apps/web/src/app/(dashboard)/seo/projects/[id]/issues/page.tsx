import { getSeoIssues } from "@automation/db";
import { DataTable } from "@/components/data-table";
import { FilterBar, FilterSelect } from "@/components/filters";
import { Pagination } from "@/components/pagination";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { flat, oneOf, page, type RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";
import { formatDate } from "@/components/data-table";
import { NotConnected } from "../not-connected";

export const metadata = { title: "SEO issues" };
const SEV = ["critical", "high", "medium", "low", "info"] as const;
const STATUS = [
  "active",
  "fixed",
  "ignored",
  "open",
  "reopened",
  "acknowledged",
  "in_progress",
] as const;

export default async function IssuesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawParams>;
}) {
  const actor = await requireActor();
  const { id } = await params;
  const raw = await searchParams;
  const severity = oneOf(raw.severity, SEV);
  const status = oneOf(raw.status, STATUS);
  const data = await getSeoIssues(actor, id, { severity, status, page: page(raw.page) });
  const filtered = Boolean(severity || status);
  if (data.total === 0 && !filtered) return <NotConnected what="issues" />;
  return (
    <>
      <FilterBar>
        <FilterSelect
          name="severity"
          label="Severity"
          allLabel="All severities"
          options={SEV.map((s) => ({ value: s, label: s }))}
        />
        <FilterSelect
          name="status"
          label="Status"
          allLabel="Open issues"
          options={STATUS.filter((s) => s !== "active").map((s) => ({
            value: s,
            label: s.replace("_", " "),
          }))}
        />
      </FilterBar>
      <DataTable
        caption="SEO issues"
        rows={data.rows}
        columns={[
          {
            key: "title",
            header: "Issue",
            cell: (i) => (
              <div className="max-w-md">
                <p className="font-medium">{i.title}</p>
                <p className="text-xs text-muted-foreground">
                  {i.details.section ?? "Site audit"}
                  {i.details.pagesAffected
                    ? ` · ${i.details.pagesAffected} page${i.details.pagesAffected === 1 ? "" : "s"} affected`
                    : ""}
                </p>
                {i.details.sampleUrls && i.details.sampleUrls.length > 0 ? (
                  <details className="mt-1 text-xs">
                    <summary className="cursor-pointer text-primary">
                      Example pages ({i.details.sampleUrls.length})
                    </summary>
                    <ul className="mt-1 space-y-0.5 break-all text-muted-foreground">
                      {i.details.sampleUrls.map((u) => (
                        <li key={u}>{u}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            ),
          },
          {
            key: "sev",
            header: "Severity",
            cell: (i) => <StatusBadge kind="severity" status={i.severity} />,
          },
          {
            key: "status",
            header: "Status",
            cell: (i) => <StatusBadge kind="issue" status={i.status} />,
          },
          {
            key: "seen",
            header: "Last seen",
            hideOnMobile: true,
            cell: (i) => formatDate(i.lastSeenAt),
          },
          {
            key: "src",
            header: "Source",
            hideOnMobile: true,
            cell: (i) =>
              i.externalSource === "se_ranking" ? (
                <Badge tone="outline">SE Ranking</Badge>
              ) : (
                "Platform"
              ),
          },
        ]}
      />
      <Pagination
        page={data.page}
        pageCount={data.pageCount}
        total={data.total}
        searchParams={flat(raw)}
        basePath={`/seo/projects/${id}/issues`}
      />
    </>
  );
}
