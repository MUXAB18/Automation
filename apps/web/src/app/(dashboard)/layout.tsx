import { LogOut } from "lucide-react";
import { SidebarNav } from "@/components/sidebar-nav";
import { Button } from "@/components/ui/button";
import { getActiveCustomer } from "@/lib/active-customer";
import { requireActor } from "@/lib/session";
import { signOutAction } from "../login/actions";
import { CustomerSwitcher } from "./customer-switcher";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const { options, activeId } = await getActiveCustomer(actor);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col gap-6 border-r border-border bg-card p-3 md:flex">
        <div className="px-3 pt-2 text-sm font-semibold">SEO &amp; Social Automation</div>
        <SidebarNav />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-2.5 md:px-6">
          <CustomerSwitcher options={options} activeId={activeId} allowAll={actor.isAdmin} />
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{actor.email}</span>
            <form action={signOutAction}>
              <Button type="submit" variant="ghost" size="sm">
                <LogOut className="size-4" aria-hidden />
                Sign out
              </Button>
            </form>
          </div>
        </header>
        <div className="border-b border-border bg-card md:hidden">
          <SidebarNav orientation="horizontal" />
        </div>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
