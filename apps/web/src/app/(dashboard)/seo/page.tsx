import { Search } from "lucide-react";
import { getSeoWorkspace } from "@automation/db";
import { DataTable, dash, formatDate } from "@/components/data-table";
import { FilterBar, SearchInput } from "@/components/filters";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { ScopeBadge } from "@/components/scope-badge";
import { DevelopmentNotice, EmptyState, SampleBadge, SampleBanner } from "@/components/states";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getScope } from "@/lib/scope";
import { requireSection } from "@/lib/sections";
import { flat, page, str, type RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";

export const metadata = { title: "SEO" };

const SOURCE_LABEL: Record<string, string> = {
  search_console: "Search Console",
  serp_api: "SERP API",
  manual: "Manual",
};

export default async function SeoPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const actor = await requireActor();
  await requireSection(actor, "seo");
  const raw = await searchParams;
  const scope = await getScope(actor);
  const q = str(raw.q);
  const data = await getSeoWorkspace(actor, {
    clientId: scope.clientId,
    projectId: scope.projectId,
    q,
    page: page(raw.page),
  });
  const kw = data.keywords;
  const withRank = kw.rows.filter((k) => k.keywordRankSnapshots[0]);

  return (
    <>
      <PageHeader
        title="SEO"
        description="Keywords, rankings, audits and issues."
        breadcrumbs={[{ label: "SEO" }]}
        badges={<ScopeBadge scope={scope} />}
      />
      <DevelopmentNotice>
        Adding keywords, running audits and pulling rankings from Google Search Console are coming
        next. This page shows what is stored in your database; ranks appear once a provider is
        connected.
      </DevelopmentNotice>
      <SampleBanner show={kw.rows.some((k) => k.isSample)} />

      <section aria-label="Summary" className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Tracked keywords"
          value={kw.total}
          icon={Search}
          helper={`${withRank.length} with a rank on this page`}
        />
        <StatCard
          label="Open issues"
          value={data.openIssueCount}
          icon={Search}
          tone={data.openIssueCount > 0 ? "warning" : "default"}
          helper="From site audits"
        />
        <StatCard
          label="Competitors"
          value={data.competitors}
          icon={Search}
          helper="Domains being compared"
        />
        <StatCard
          label="Audits"
          value={data.audits.length}
          icon={Search}
          helper={
            data.audits[0] ? `Latest ${formatDate(data.audits[0].createdAt)}` : "None run yet"
          }
        />
      </section>

      <FilterBar>
        <SearchInput placeholder="Search keywords" />
      </FilterBar>

      <h2 className="mb-3 text-lg font-semibold">Keywords</h2>
      {kw.total === 0 ? (
        <EmptyState
          icon={Search}
          title={q ? "No keywords match your search" : "No keywords tracked yet"}
          description={
            q
              ? "Try a different search."
              : "Tracked keywords and their latest rank will be listed here."
          }
        />
      ) : (
        <>
          <DataTable
            caption="Tracked keywords"
            rows={kw.rows}
            columns={[
              {
                key: "term",
                header: "Keyword",
                cell: (k) => (
                  <span className="inline-flex flex-wrap items-center gap-2 font-medium">
                    {k.term} <SampleBadge show={k.isSample} />
                  </span>
                ),
              },
              { key: "client", header: "Client", hideOnMobile: true, cell: (k) => k.client.name },
              {
                key: "market",
                header: "Market",
                hideOnMobile: true,
                cell: (k) => `${k.country} · ${k.device}`,
              },
              {
                key: "rank",
                header: "Latest position",
                cell: (k) => {
                  const snap = k.keywordRankSnapshots[0];
                  return snap ? (
                    <span className="inline-flex items-center gap-2">
                      {snap.position === null ? "Not ranking" : Number(snap.position).toFixed(1)}
                      <Badge tone="success" title="Read from a provider">
                        {SOURCE_LABEL[snap.source] ?? snap.source}
                      </Badge>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">No data yet</span>
                  );
                },
              },
              {
                key: "checked",
                header: "Checked",
                hideOnMobile: true,
                cell: (k) => dash(formatDate(k.keywordRankSnapshots[0]?.checkedOn)),
              },
            ]}
          />
          <Pagination
            page={kw.page}
            pageCount={kw.pageCount}
            total={kw.total}
            searchParams={flat(raw)}
            basePath="/seo"
          />
        </>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Open issues</CardTitle>
          </CardHeader>
          <CardContent>
            {data.issues.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No open issues. Findings from site audits will appear here.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {data.issues.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{i.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {i.client.name} · last seen {formatDate(i.lastSeenAt)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <StatusBadge kind="severity" status={i.severity} />
                      <StatusBadge kind="issue" status={i.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent audits</CardTitle>
          </CardHeader>
          <CardContent>
            {data.audits.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No audits have run yet.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {data.audits.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                    <div>
                      <p className="font-medium">{a.client.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(a.createdAt)} · {a.pagesCrawled} pages
                      </p>
                    </div>
                    <StatusBadge kind="audit" status={a.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
