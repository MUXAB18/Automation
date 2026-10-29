import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  className?: string;
  align?: "left" | "right";
  /** Hide below the `md` breakpoint to keep narrow screens readable. */
  hideOnMobile?: boolean;
};

/**
 * Plain, accessible table for server-rendered lists. Filtering, sorting and paging are done by the
 * server through URL parameters (see filters.tsx / pagination.tsx), so this component has no state.
 */
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  caption,
  rowHref,
}: {
  columns: Column<T>[];
  rows: T[];
  /** Describes the table to screen readers (visually hidden). */
  caption: string;
  rowHref?: (row: T) => string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      <Table>
        <caption className="sr-only">{caption}</caption>
        <TableHeader className="bg-muted/40">
          <TableRow className="hover:bg-transparent">
            {columns.map((c) => (
              <TableHead
                key={c.key}
                scope="col"
                className={cn(
                  "h-11 px-4 text-xs font-medium uppercase tracking-wide text-muted-foreground",
                  c.align === "right" && "text-right",
                  c.hideOnMobile && "hidden md:table-cell",
                  c.className,
                )}
              >
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              {columns.map((c, i) => (
                <TableCell
                  key={c.key}
                  className={cn(
                    "px-4 py-3 align-middle",
                    c.align === "right" && "text-right",
                    c.hideOnMobile && "hidden md:table-cell",
                    c.className,
                  )}
                >
                  {i === 0 && rowHref ? (
                    <Link
                      href={rowHref(row)}
                      className="font-medium hover:underline focus-visible:underline"
                    >
                      {c.cell(row)}
                    </Link>
                  ) : (
                    c.cell(row)
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** "—" for missing values, so empty cells never look like a bug. */
export const dash = (value: React.ReactNode) =>
  value === null || value === undefined || value === "" ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    value
  );

export const formatDate = (d: Date | null | undefined) =>
  d
    ? new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "short", day: "numeric" }).format(
        d,
      )
    : null;
