import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";

export type Crumb = { label: string; href?: string };

/** Overview > Section > Page. The last crumb is the current page (no link, aria-current). */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <li>
          <Link
            href="/"
            className="inline-flex items-center rounded p-0.5 hover:text-foreground"
            aria-label="Overview"
          >
            <Home className="size-4" aria-hidden />
          </Link>
        </li>
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1">
              <ChevronRight className="size-3.5 shrink-0" aria-hidden />
              {item.href && !last ? (
                <Link href={item.href} className="rounded hover:text-foreground hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? "page" : undefined}
                  className={last ? "font-medium text-foreground" : undefined}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
