"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  LineChart,
  FileText,
  Share2,
  FileBarChart,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/customers", label: "Customers", icon: Users },
  { label: "Rankings", icon: LineChart },
  { label: "Content", icon: FileText },
  { label: "Social", icon: Share2 },
  { label: "Reports", icon: FileBarChart },
  { label: "Settings", icon: Settings },
] as const;

export function SidebarNav({
  orientation = "vertical",
}: {
  orientation?: "vertical" | "horizontal";
}) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className={cn(
        "flex gap-1",
        orientation === "vertical" ? "flex-col" : "overflow-x-auto px-3 py-2",
      )}
    >
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const base =
          "flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors";
        if (!("href" in item)) {
          return (
            <span
              key={item.label}
              aria-disabled="true"
              title="Coming soon"
              className={cn(base, "cursor-not-allowed text-muted-foreground/50")}
            >
              <Icon className="size-[18px]" aria-hidden />
              {item.label}
              {orientation === "vertical" ? (
                <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                  Soon
                </span>
              ) : null}
            </span>
          );
        }
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              base,
              active
                ? "bg-primary-soft font-medium text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-[18px]" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
