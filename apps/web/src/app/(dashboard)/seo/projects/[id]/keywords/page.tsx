import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { getSeoKeywords } from "@automation/db";
import { DataTable, dash } from "@/components/data-table";
import { FilterBar, SearchInput } from "@/components/filters";
import { Pagination } from "@/components/pagination";
import { Sparkline } from "@/components/seo/charts";
import { Badge } from "@/components/ui/badge";
import { flat, page, str, type RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";
import { NotConnected } from "../not-connected";

export const metadata = { title: "Keywords" };
const SOURCE: Record<string, string> = {
  se_ranking: "SE Ranking",
  search_console: "Search Console",
  serp_api: "SERP API",
  manual: "Manual",
};

export default async function KeywordsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawParams>;
}) {
  const actor = await requireActor();
  const { id } = await params;
  const raw = await searchParams;
  const data = await getSeoKeywords(actor, id, { q: str(raw.q), page: page(raw.page) });
  if (data.total === 0 && !str(raw.q)) return <NotConnected what="keywords" />;
  return (
    <>
      <FilterBar>
        <SearchInput placeholder="Search keywords" />
      </FilterBar>
      <DataTable
        caption="Keywords with their latest ranking"
        rows={data.rows}
        columns={[
          {
            key: "term",
            header: "Keyword",
            cell: (k) => <span className="font-medium">{k.term}</span>,
          },
          {
            key: "pos",
            header: "Position",
            align: "right",
            cell: (k) =>
              k.checkedOn === null ? (
                <span className="text-muted-foreground">No reading</span>
              ) : k.position === null ? (
                <span className="text-muted-foreground">Not ranking</span>
              ) : (
                <span className="tabular-nums">{k.position}</span>
              ),
          },
          {
            key: "change",
            header: "Change",
            align: "right",
            cell: (k) =>
              k.change === null ? (
                <Minus
                  className="ml-auto size-4 text-muted-foreground"
                  aria-label="No comparison"
                />
              ) : k.change > 0 ? (
                <span className="inline-flex items-center gap-1 text-success">
                  <ArrowUp className="size-3.5" aria-hidden />
                  {k.change}
                  <span className="sr-only"> places better</span>
                </span>
              ) : k.change < 0 ? (
                <span className="inline-flex items-center gap-1 text-destructive">
                  <ArrowDown className="size-3.5" aria-hidden />
                  {Math.abs(k.change)}
                  <span className="sr-only"> places worse</span>
                </span>
              ) : (
                <span className="text-muted-foreground">0</span>
              ),
          },
          {
            key: "trend",
            header: "Trend",
            hideOnMobile: true,
            cell: (k) => <Sparkline series={k.series} label={`Position history of ${k.term}`} />,
          },
          {
            key: "volume",
            header: "Volume",
            align: "right",
            hideOnMobile: true,
            cell: (k) => dash(k.volume?.toLocaleString("en-CA")),
          },
          {
            key: "url",
            header: "Ranking page",
            hideOnMobile: true,
            cell: (k) =>
              k.url ? (
                <span
                  className="block max-w-56 truncate text-xs text-muted-foreground"
                  title={k.url}
                >
                  {k.url}
                </span>
              ) : (
                "—"
              ),
          },
          {
            key: "src",
            header: "Source",
            hideOnMobile: true,
            cell: (k) =>
              k.source ? <Badge tone="outline">{SOURCE[k.source] ?? k.source}</Badge> : "—",
          },
        ]}
      />
      <Pagination
        page={data.page}
        pageCount={data.pageCount}
        total={data.total}
        searchParams={flat(raw)}
        basePath={`/seo/projects/${id}/keywords`}
      />
    </>
  );
}
