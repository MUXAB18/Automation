import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ROLE_TEMPLATES, getAccessMap, isClientOnlyUser, listNotifications } from "@automation/db";
import { DesktopSidebar, MobileNav } from "@/components/app/app-sidebar";
import { NotificationsMenu, type NotificationItem } from "@/components/app/notifications-menu";
import { ScopeSwitcher } from "@/components/app/scope-switcher";
import { UserMenu } from "@/components/app/user-menu";
import { BrandMark } from "@/components/brand-mark";
import { sectionForPath } from "@/lib/nav";
import { getScope } from "@/lib/scope";
import { getVisibleSections } from "@/lib/sections";
import { requireActor } from "@/lib/session";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";

function initials(name: string, email: string) {
  const parts = (name.trim() || email).split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function timeAgo(date: Date) {
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, size] of [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ] as const) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Every request: a verified session from the database, or a redirect to /login.
  const actor = await requireActor();
  // A client's own people use the portal, never the agency screens.
  if (await isClientOnlyUser(actor)) redirect("/portal");
  const [scope, visible, notifications, access] = await Promise.all([
    getScope(actor),
    getVisibleSections(actor),
    listNotifications(actor),
    getAccessMap(actor),
  ]);

  // Refuse a section the user may not use BEFORE anything streams, so the response is a real 404.
  // (Each page also calls requireSection; this is the early, status-correct check.)
  const section = sectionForPath((await headers()).get("x-pathname") ?? "");
  if (section && !visible.includes(section)) notFound();

  const roleNames = actor.isAdmin
    ? "Platform admin"
    : [...new Set([...access.values()].flatMap((a) => [...a.roles]))]
        .map((key) => ROLE_TEMPLATES.find((r) => r.key === key)?.name ?? key)
        .sort()
        .join(", ") || "No roles";
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const items: NotificationItem[] = notifications.items.map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    when: timeAgo(n.createdAt),
    unread: n.readAt === null,
    sample:
      typeof n.data === "object" && n.data !== null && "sample" in n.data && n.data.sample === true,
  }));

  return (
    <div className="flex min-h-screen gap-4 p-2 sm:p-3 lg:p-4">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-card px-3 py-2 text-sm shadow focus:not-sr-only focus:absolute focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <DesktopSidebar visible={visible} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 -mx-1 flex h-20 items-center justify-between gap-3 bg-background/85 px-1 backdrop-blur sm:px-3">
          <div className="flex min-w-0 items-center gap-2">
            <MobileNav visible={visible} />
            <BrandMark className="size-8 lg:hidden" />
            <ScopeSwitcher
              clients={scope.clients.map((c) => ({
                id: c.id,
                name: c.name,
                hint: c.status !== "active" ? c.status : undefined,
              }))}
              clientId={scope.clientId}
              projects={scope.projects.map((p) => ({
                id: p.id,
                name: p.name,
                hint: p.isSample ? "sample" : undefined,
              }))}
              projectId={scope.projectId}
            />
          </div>
          <div className="flex items-center gap-3">
            <NotificationsMenu items={items} unread={notifications.unread} />
            <UserMenu
              name={actor.name || actor.email}
              email={actor.email}
              roles={roleNames}
              initials={initials(actor.name, actor.email)}
              theme={theme}
            />
          </div>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="fade-up mx-auto w-full max-w-[84rem] flex-1 px-1 pb-8 pt-2 outline-none sm:px-3 lg:px-4"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
