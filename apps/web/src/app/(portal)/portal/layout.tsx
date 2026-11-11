import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccessMap, isClientOnlyUser } from "@automation/db";
import { UserMenu } from "@/components/app/user-menu";
import { BrandMark } from "@/components/brand-mark";
import { requireActor } from "@/lib/session";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";

export const metadata = { title: { default: "Client portal", template: "%s · Client portal" } };

/**
 * The client portal shell. It has no agency navigation and no client switcher of its own: every page asks the same
 * authorised services as the agency screens, which only ever return what this person's client roles allow.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const access = await getAccessMap(actor);
  // Staff belong in the agency screens; people with no access at all have nothing to see here.
  if (!(await isClientOnlyUser(actor)) && !actor.isAdmin && access.size > 0) redirect("/");
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const initials = (
    (actor.name || actor.email)
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0])
      .join("") || "?"
  ).toUpperCase();
  return (
    <div className="min-h-screen p-2 sm:p-3 lg:p-4">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-card px-3 py-2 text-sm shadow focus:not-sr-only focus:absolute focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <header className="mx-auto flex h-20 w-full max-w-[72rem] items-center justify-between gap-3 px-1 sm:px-3">
        <Link href="/portal" className="flex items-center gap-3">
          <BrandMark />
          <span className="text-lg font-semibold tracking-tight">Client portal</span>
        </Link>
        <UserMenu
          name={actor.name || actor.email}
          email={actor.email}
          roles="Client"
          initials={initials}
          theme={theme}
        />
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="fade-up mx-auto w-full max-w-[72rem] px-1 pb-10 pt-2 outline-none sm:px-3"
      >
        {children}
      </main>
    </div>
  );
}
