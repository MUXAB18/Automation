import type { Permission } from "@automation/db";

/**
 * The 13 sections of the app. `permission` is the permission a user needs on at least one client
 * to see the section (null = everyone signed in). `status: "preview"` marks sections that read real
 * data but whose provider-backed features are not built yet; they are labelled in the UI.
 * Visibility here is a convenience: each page re-checks on the server (lib/sections.ts).
 */
export type SectionKey =
  | "overview"
  | "clients"
  | "projects"
  | "tasks"
  | "seo"
  | "content"
  | "social"
  | "analytics"
  | "reports"
  | "automation"
  | "integrations"
  | "team"
  | "settings";

export type Section = {
  key: SectionKey;
  label: string;
  href: string;
  group: "Workspace" | "Marketing" | "Automation" | "Admin";
  permission: Permission | null;
  /** Agency-level permission (checked per agency instead of per client). */
  agencyPermission?: Permission;
  status: "live" | "preview";
  description: string;
};

export const SECTIONS: readonly Section[] = [
  {
    key: "overview",
    label: "Overview",
    href: "/",
    group: "Workspace",
    permission: null,
    status: "live",
    description: "What needs attention across your clients.",
  },
  {
    key: "clients",
    label: "Clients",
    href: "/clients",
    group: "Workspace",
    permission: "client.view",
    status: "live",
    description: "Businesses managed from this dashboard.",
  },
  {
    key: "projects",
    label: "Projects",
    href: "/projects",
    group: "Workspace",
    permission: "client.view",
    status: "live",
    description: "Programmes of work for each client.",
  },
  {
    key: "tasks",
    label: "Tasks",
    href: "/tasks",
    group: "Workspace",
    permission: "task.view",
    status: "live",
    description: "Everything that needs doing, across clients.",
  },
  {
    key: "seo",
    label: "SEO",
    href: "/seo",
    group: "Marketing",
    permission: "seo.view",
    status: "live",
    description: "Keywords, rankings, audits and issues.",
  },
  {
    key: "content",
    label: "Content",
    href: "/content",
    group: "Marketing",
    permission: "content.view",
    status: "live",
    description: "Plan, review and schedule content.",
  },
  {
    key: "social",
    label: "Publishing",
    href: "/social",
    group: "Marketing",
    permission: "content.view",
    status: "live",
    description: "Publishing queue and published posts.",
  },
  {
    key: "analytics",
    label: "Analytics",
    href: "/analytics",
    group: "Marketing",
    permission: "analytics.view",
    status: "live",
    description: "Search and traffic performance.",
  },
  {
    key: "reports",
    label: "Reports",
    href: "/reports",
    group: "Marketing",
    permission: "report.view",
    status: "live",
    description: "Client reports and deliveries.",
  },
  {
    key: "automation",
    label: "Automation",
    href: "/automation",
    group: "Automation",
    permission: "automation.view",
    status: "live",
    description: "Rules that run work for each client.",
  },
  {
    key: "integrations",
    label: "Integrations",
    href: "/integrations",
    group: "Automation",
    permission: "integration.view",
    status: "live",
    description: "Connected accounts and data sources.",
  },
  {
    key: "team",
    label: "Team",
    href: "/team",
    group: "Admin",
    permission: null,
    agencyPermission: "agency.members",
    status: "live",
    description: "People, roles and invitations.",
  },
  {
    key: "settings",
    label: "Settings",
    href: "/settings",
    group: "Admin",
    permission: null,
    status: "live",
    description: "Your account and workspace.",
  },
];

export const sectionByKey = (key: SectionKey): Section => SECTIONS.find((s) => s.key === key)!;

/** Which section a URL path belongs to (longest matching prefix), or undefined for other pages. */
export function sectionForPath(pathname: string): SectionKey | undefined {
  if (pathname === "/") return "overview";
  return SECTIONS.filter(
    (s) => s.href !== "/" && (pathname === s.href || pathname.startsWith(`${s.href}/`)),
  ).sort((a, b) => b.href.length - a.href.length)[0]?.key;
}
