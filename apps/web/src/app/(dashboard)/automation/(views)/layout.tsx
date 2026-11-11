import { listTemplates } from "@automation/db";
import { PageHeader } from "@/components/page-header";
import { ScopeBadge } from "@/components/scope-badge";
import { TabsNav } from "@/components/tabs-nav";
import { getScope } from "@/lib/scope";
import { requireSection } from "@/lib/sections";
import { requireActor } from "@/lib/session";

/** Header and tabs shared by the automation pages: rules, executions, findings and (for agency admins) templates. */
export default async function AutomationLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  await requireSection(actor, "automation");
  const scope = await getScope(actor);
  const { agencyId } = await listTemplates(actor);
  return (
    <>
      <PageHeader
        title="Automation"
        description="Rules watch your synced SEO and analytics data and turn problems into assigned, deduplicated tasks."
        breadcrumbs={[{ label: "Automation" }]}
        badges={<ScopeBadge scope={scope} />}
      />
      <TabsNav
        label="Automation views"
        tabs={[
          { href: "/automation", label: "Rules", exact: true },
          { href: "/automation/runs", label: "Execution history" },
          { href: "/automation/findings", label: "Findings" },
          ...(agencyId ? [{ href: "/automation/templates", label: "Agency templates" }] : []),
        ]}
      />
      {children}
    </>
  );
}
