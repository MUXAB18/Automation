import Link from "next/link";
import { Send } from "lucide-react";
import { getPublishing } from "@automation/db";
import { DataTable, dash, formatDate } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { ScopeBadge } from "@/components/scope-badge";
import { EmptyState } from "@/components/states";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getScope } from "@/lib/scope";
import { requireSection } from "@/lib/sections";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Publishing" };

const link = (id: string, title: string) => (
  <Link href={`/content/${id}`} className="font-medium hover:underline">
    {title}
  </Link>
);

export default async function SocialPage() {
  const actor = await requireActor();
  await requireSection(actor, "social");
  const scope = await getScope(actor);
  const data = await getPublishing(actor, { clientId: scope.clientId });
  const inQueue = data.jobs.filter((j) =>
    ["queued", "scheduled", "publishing"].includes(j.status),
  ).length;

  return (
    <>
      <PageHeader
        title="Publishing"
        description="Posts waiting to go out, posts that have gone live, and anything that needs a person. Schedule and approve content from the content calendar."
        breadcrumbs={[{ label: "Publishing" }]}
        badges={<ScopeBadge scope={scope} />}
      />
      <section aria-label="Summary" className="mb-6 grid gap-4 sm:grid-cols-4">
        <StatCard
          label="Connected accounts"
          value={data.connectedAccounts}
          icon={Send}
          helper="Social accounts with active access"
        />
        <StatCard
          label="In the queue"
          value={inQueue}
          icon={Send}
          helper="Queued, scheduled or publishing"
        />
        <StatCard
          label="Needs attention"
          value={data.needsAttention}
          icon={Send}
          tone={data.needsAttention > 0 ? "warning" : "default"}
          helper="Failed, or outcome unknown"
        />
        <StatCard
          label="Published"
          value={data.posts.length + data.manual.length}
          icon={Send}
          helper="Most recent shown below"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Publishing queue</CardTitle>
          </CardHeader>
          <CardContent>
            {data.jobs.length === 0 ? (
              <EmptyState
                icon={Send}
                title="Nothing queued"
                description="Approved content scheduled for publishing is listed here."
                className="border-0 py-8"
              />
            ) : (
              <DataTable
                caption="Publishing jobs"
                rows={data.jobs}
                columns={[
                  {
                    key: "title",
                    header: "Content",
                    cell: (j) => link(j.contentItem.id, j.contentItem.title),
                  },
                  {
                    key: "status",
                    header: "Status",
                    cell: (j) => <StatusBadge kind="publishing" status={j.status} />,
                  },
                  {
                    key: "via",
                    header: "Account",
                    hideOnMobile: true,
                    cell: (j) => j.integrationAccount.displayName ?? "Provider",
                  },
                  {
                    key: "when",
                    header: "Scheduled",
                    hideOnMobile: true,
                    cell: (j) => dash(formatDate(j.scheduledFor)),
                  },
                ]}
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Published through a connected account</CardTitle>
          </CardHeader>
          <CardContent>
            {data.posts.length === 0 ? (
              <EmptyState
                icon={Send}
                title="No published posts"
                description="Posts published through a connected account are listed here."
                className="border-0 py-8"
              />
            ) : (
              <DataTable
                caption="Published posts"
                rows={data.posts}
                columns={[
                  {
                    key: "title",
                    header: "Content",
                    cell: (p) => link(p.contentItem.id, p.contentItem.title),
                  },
                  {
                    key: "status",
                    header: "Status",
                    cell: (p) => <StatusBadge kind="post" status={p.status} />,
                  },
                  {
                    key: "when",
                    header: "Published",
                    hideOnMobile: true,
                    cell: (p) => formatDate(p.publishedAt),
                  },
                ]}
              />
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Published by hand</CardTitle>
          </CardHeader>
          <CardContent>
            {data.manual.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Posts someone published manually (website, email, posts with media) are recorded
                here with the link.
              </p>
            ) : (
              <DataTable
                caption="Posts published by hand"
                rows={data.manual}
                columns={[
                  {
                    key: "title",
                    header: "Content",
                    cell: (p) => link(p.contentItem.id, p.contentItem.title),
                  },
                  {
                    key: "by",
                    header: "Recorded by",
                    hideOnMobile: true,
                    cell: (p) => p.markedBy.name,
                  },
                  { key: "when", header: "Published", cell: (p) => formatDate(p.publishedAt) },
                  {
                    key: "url",
                    header: "Link",
                    hideOnMobile: true,
                    cell: (p) =>
                      p.publishedUrl ? (
                        <a
                          href={p.publishedUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary underline"
                        >
                          Open
                        </a>
                      ) : (
                        "None"
                      ),
                  },
                ]}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
