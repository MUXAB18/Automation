import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PAGE_SIZE } from "@automation/db";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Server-rendered pager: plain links, so it works without JavaScript and every page is linkable. */
export function Pagination({
  page,
  pageCount,
  total,
  searchParams,
  basePath,
}: {
  page: number;
  pageCount: number;
  total: number;
  searchParams: Record<string, string | undefined>;
  basePath: string;
}) {
  if (total === 0) return null;
  const href = (p: number) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (v && k !== "page") next.set(k, v);
    if (p > 1) next.set("page", String(p));
    const qs = next.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const link = cn(buttonVariants({ variant: "outline", size: "sm" }));
  const disabled = cn(link, "pointer-events-none opacity-50");
  return (
    <nav
      aria-label="Pagination"
      className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"
    >
      <p>
        Showing {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={link} rel="prev">
            <ChevronLeft className="size-4" aria-hidden /> Previous
          </Link>
        ) : (
          <span className={disabled} aria-disabled="true">
            <ChevronLeft className="size-4" aria-hidden /> Previous
          </span>
        )}
        <span aria-current="page">
          Page {page} of {pageCount}
        </span>
        {page < pageCount ? (
          <Link href={href(page + 1)} className={link} rel="next">
            Next <ChevronRight className="size-4" aria-hidden />
          </Link>
        ) : (
          <span className={disabled} aria-disabled="true">
            Next <ChevronRight className="size-4" aria-hidden />
          </span>
        )}
      </div>
    </nav>
  );
}
