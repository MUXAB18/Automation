import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { SyncIndicator } from "@/components/seo/sync-indicator";
import { TabsNav } from "@/components/tabs-nav";
import { loadSeoHeader } from "@/lib/cached";
import { requireSection } from "@/lib/sections";
import { requireActor } from "@/lib/session";

/** Header, last-sync indicator and tabs shared by every view of one SEO project. */
export default async function SeoProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const actor = await requireActor();
  await requireSection(actor, "seo");
  const { id } = await params;
  const header = await loadSeoHeader(actor, id).catch(() => null);
  if (!header) notFound();
  const base = `/seo/projects/${id}`;
  const issues = Object.values(header.issues).reduce<number>((a, b) => a + (b ?? 0), 0);
  return (
    <>
      <PageHeader
        title={header.name}
        description={header.domain}
        breadcrumbs={[{ label: "SEO", href: "/seo" }, { label: header.name }]}
        badges={<SyncIndicator provider={header.provider} />}
      />
      <TabsNav
        label="SEO project views"
        tabs={[
          { href: base, label: "Overview", exact: true },
          { href: `${base}/keywords`, label: "Keywords", count: header.stats.keywords },
          { href: `${base}/audit`, label: "Site audit" },
          {
            href: `${base}/issues`,
            label: "Issues",
            count: issues,
            countTone: issues > 0 ? "danger" : "neutral",
          },
          { href: `${base}/competitors`, label: "Competitors", count: header.competitors },
          { href: `${base}/backlinks`, label: "Backlinks" },
        ]}
      />
      {children}
    </>
  );
}
