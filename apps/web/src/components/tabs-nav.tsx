"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type Tab = {
  href: string;
  label: string;
  /** Match only this exact path (for the first tab). */
  exact?: boolean;
  /** A small number shown beside the label (e.g. overdue tasks). */
  count?: number;
  countTone?: "neutral" | "danger";
};

/** Link-based tabs: each tab is its own page, so every view is linkable and server-rendered. */
export function TabsNav({ tabs, label }: { tabs: Tab[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => {
        const active = t.exact
          ? pathname === t.href
          : pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
              active
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 ? (
              <span
                className={cn(
                  "ml-2 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
                  t.countTone === "danger"
                    ? "bg-destructive/15 text-destructive"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {t.count}
                <span className="sr-only"> items</span>
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
