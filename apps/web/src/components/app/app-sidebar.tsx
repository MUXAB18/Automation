"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  CalendarDays,
  FileBarChart,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  Menu,
  Plug,
  Search,
  Settings,
  Share2,
  Users,
  UserCog,
  Workflow,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SECTIONS, type Section, type SectionKey } from "@/lib/nav";
import { cn } from "@/lib/utils";

const ICONS: Record<SectionKey, React.ComponentType<{ className?: string }>> = {
  overview: LayoutDashboard,
  clients: Users,
  projects: FolderKanban,
  tasks: ListChecks,
  seo: Search,
  content: CalendarDays,
  social: Share2,
  analytics: BarChart3,
  reports: FileBarChart,
  automation: Workflow,
  integrations: Plug,
  team: UserCog,
  settings: Settings,
};

const isActive = (section: Section, pathname: string) =>
  section.href === "/"
    ? pathname === "/"
    : pathname === section.href || pathname.startsWith(`${section.href}/`);

/**
 * `visible` is computed on the server from the user's real permissions. It only decides what to
 * show: every page re-checks (requireSection), so editing it in dev tools grants nothing.
 */
function NavList({
  visible,
  onNavigate,
}: {
  visible: readonly SectionKey[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const groups = ["Workspace", "Marketing", "Automation", "Admin"] as const;
  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {groups.map((group) => {
        const items = SECTIONS.filter((s) => s.group === group && visible.includes(s.key));
        if (items.length === 0) return null;
        return (
          <div key={group}>
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
              {group}
            </p>
            <ul className="flex flex-col gap-1">
              {items.map((section) => {
                const Icon = ICONS[section.key];
                const active = isActive(section, pathname);
                return (
                  <li key={section.key}>
                    <Link
                      href={section.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-xl px-3.5 py-2 text-sm transition-all focus-visible:outline-2 focus-visible:outline-ring",
                        active
                          ? "bg-primary font-semibold text-white shadow-lg shadow-primary/30"
                          : "font-medium text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Icon className="size-[18px] shrink-0" aria-hidden />
                      <span className="flex-1 truncate">{section.label}</span>
                      {section.status === "preview" ? (
                        <Badge
                          tone="outline"
                          className={cn(
                            "px-1.5 py-0 text-[10px] uppercase tracking-wide",
                            active && "border-white/40 text-white",
                          )}
                          title="Under development"
                        >
                          Preview
                        </Badge>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link
      href="/"
      className="flex items-center gap-3 rounded-lg px-2 py-1 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <BrandMark />
      <span className="leading-tight">
        <span className="block text-sm font-semibold tracking-tight">SEO &amp; Social</span>
        <span className="block text-xs text-muted-foreground">Automation</span>
      </span>
    </Link>
  );
}

/** A dark call-to-action card at the foot of the sidebar: the one next step that matters for a new workspace. */
function SidebarPromo() {
  return (
    <div className="relative hidden overflow-hidden rounded-2xl bg-[oklch(0.2_0.03_275)] p-4 text-white [@media(min-height:960px)]:block">
      <span
        aria-hidden
        className="absolute -right-6 -top-6 size-24 rounded-full bg-primary/40 blur-2xl"
      />
      <span className="relative inline-flex size-9 items-center justify-center rounded-xl bg-white/10">
        <Plug className="size-4" aria-hidden />
      </span>
      <p className="relative mt-3 text-sm font-semibold">Connect your data</p>
      <p className="relative mt-1 text-xs leading-relaxed text-white/65">
        Link SE Ranking, Google and GoHighLevel to start syncing rankings, traffic and leads.
      </p>
      <Link
        href="/integrations"
        className="relative mt-3 flex h-9 items-center justify-center rounded-xl bg-primary text-xs font-semibold text-white transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring"
      >
        Open integrations
      </Link>
    </div>
  );
}

export function DesktopSidebar({ visible }: { visible: readonly SectionKey[] }) {
  return (
    <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] w-72 shrink-0 flex-col rounded-[1.75rem] border border-border/60 bg-sidebar p-4 shadow-card lg:flex">
      <div className="px-2 pb-5 pt-1">
        <Brand />
      </div>
      <div className="-mx-1 flex-1 overflow-y-auto px-1 pb-4">
        <NavList visible={visible} />
      </div>
      <SidebarPromo />
    </aside>
  );
}

/** Hamburger + slide-over drawer, shown below the `lg` breakpoint. Closes when you navigate. */
export function MobileNav({ visible }: { visible: readonly SectionKey[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation menu">
          <Menu className="size-5" aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-0 bg-sidebar p-0">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">
          Move between sections of the dashboard
        </SheetDescription>
        <div className="px-4 py-5">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-6">
          <NavList visible={visible} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
