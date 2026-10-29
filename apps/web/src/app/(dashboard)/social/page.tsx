import { Send } from "lucide-react";
import { getPublishing } from "@automation/db";
import { DataTable, dash, formatDate } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { ScopeBadge } from "@/components/scope-badge";
import { DevelopmentNotice, EmptyState } from "@/components/states";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getScope } from "@/lib/scope";
import { requireSection } from "@/lib/sections";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Social Publishing" };

export default async function SocialPage() {
  const actor = await requireActor();
  await requireSection(actor, "social");
  const scope = await getScope(actor);
  const data = await getPublishing(actor, { clientId: scope.clientId });

  return (
    <>
      <PageHeader
        title="Social Publishing"
        description="The publishing queue and posts that have gone live."
        breadcrumbs={[{ label: "Social Publishing" }]}
        badges={<ScopeBadge scope={scope} />}
      />
      <DevelopmentNotice>
        Connecting social accounts and publishing posts is not available yet. Publishing will always
        require an approved version of the content.
      </DevelopmentNotice>

      <section aria-label="Summary" className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Connected accounts"
          value={data.connectedAccounts}
          icon={Send}
          helper="Social accounts with active access"
        />
        <StatCard
          label="In the queue"
          value={
            data.jobs.filter((j) => ["queued", "scheduled", "publishing"].includes(j.status)).length
          }
          icon={Send}
          helper="Queued, scheduled or publishing"
        />
        <StatCard
          label="Published"
          value={data.posts.length}
          icon={Send}
          helper="Most recent 10 shown below"
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
                description="Approved content that is scheduled for publishing will be listed here."
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
                    cell: (j) => <span className="font-medium">{j.contentItem.title}</span>,
                  },
                  {
                    key: "status",
                    header: "Status",
                    cell: (j) => <StatusBadge kind="publishing" status={j.status} />,
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
            <CardTitle>Published posts</CardTitle>
          </CardHeader>
          <CardContent>
            {data.posts.length === 0 ? (
              <EmptyState
                icon={Send}
                title="No published posts"
                description="Posts published through this platform will be listed here with their results."
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
                    cell: (p) => <span className="font-medium">{p.contentItem.title}</span>,
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
      </div>
    </>
  );
}
