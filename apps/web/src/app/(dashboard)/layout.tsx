import { LogOut } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { SidebarNav } from "@/components/sidebar-nav";
import { Button } from "@/components/ui/button";
import { listAgenciesWith } from "@automation/db";
import { getActiveClient } from "@/lib/active-client";
import { requireActor } from "@/lib/session";
import { signOutAction } from "../login/actions";
import { ClientSwitcher } from "./client-switcher";

function initials(name: string, email: string) {
  const source = name.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const { options, activeId } = await getActiveClient(actor);
  const allowed = (await listAgenciesWith(actor, "agency.members")).length > 0 ? ["team"] : [];

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          <BrandMark />
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight">SEO &amp; Social</p>
            <p className="text-xs text-muted-foreground">Automation</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          <p className="px-3 pb-2 pt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Workspace
          </p>
          <SidebarNav allowed={allowed} />
        </div>
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <span
              aria-hidden
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary"
            >
              {initials(actor.name, actor.email)}
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-medium">{actor.name || actor.email}</p>
              <p className="truncate text-xs text-muted-foreground">
                {actor.isAdmin ? "Platform admin" : actor.email}
              </p>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur md:px-8">
          <div className="flex items-center gap-3">
            <BrandMark className="size-8 md:hidden" />
            <ClientSwitcher options={options} activeId={activeId} allowAll={actor.isAdmin} />
          </div>
          <form action={signOutAction}>
            <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
              <LogOut className="size-4" aria-hidden />
              Sign out
            </Button>
          </form>
        </header>
        <div className="border-b border-border bg-sidebar md:hidden">
          <SidebarNav orientation="horizontal" allowed={allowed} />
        </div>
        <main className="fade-up mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
