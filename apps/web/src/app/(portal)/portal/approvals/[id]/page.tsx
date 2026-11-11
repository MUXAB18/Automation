import Link from "next/link";
import { notFound } from "next/navigation";
import { getContentDetail } from "@automation/db";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { orNotFound } from "@/lib/guard";
import { requireActor } from "@/lib/session";
import { decideAction } from "@/app/(dashboard)/content/actions";
import { WorkflowButtons } from "@/app/(dashboard)/content/[id]/panels";

export const metadata = { title: "Approval" };

export default async function PortalApproval({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const d = await orNotFound(getContentDetail(actor, id));
  const { item, client } = d;
  // The portal shows only work that has reached the client stage; earlier drafts are internal.
  if (
    ![
      "client_approval",
      "approved",
      "scheduled",
      "publishing",
      "published",
      "changes_requested",
      "rejected",
    ].includes(item.status)
  )
    notFound();
  const meta = (item.currentVersion?.metadata ?? {}) as { hashtags?: string[] };
  return (
    <>
      <PageHeader
        title={item.title}
        description={`${item.channel.replace("_", " ")}${item.scheduledFor ? ` · planned ${item.scheduledFor.toLocaleString("en-CA", { timeZone: client.timezone, dateStyle: "medium", timeStyle: "short" })} (${client.timezone})` : ""}`}
        breadcrumbs={[{ label: "Overview", href: "/portal" }, { label: "Approval" }]}
        badges={<Badge>{item.status.replace(/_/g, " ")}</Badge>}
      />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>What will be published</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {item.currentVersion?.title ? (
              <p className="font-semibold">{item.currentVersion.title}</p>
            ) : null}
            <p className="whitespace-pre-wrap leading-relaxed">{item.currentVersion?.body}</p>
            {meta.hashtags?.length ? (
              <p className="text-muted-foreground">{meta.hashtags.join(" ")}</p>
            ) : null}
            {d.assets.length ? (
              <p className="text-xs text-muted-foreground">
                Attached: {d.assets.map((a) => a.fileName).join(", ")}
              </p>
            ) : null}
          </CardContent>
        </Card>
        <div className="grid h-fit gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Your decision</CardTitle>
            </CardHeader>
            <CardContent>
              {d.can.decide ? (
                <WorkflowButtons
                  itemId={id}
                  buttons={[
                    {
                      label: "Approve",
                      action: decideAction,
                      fields: { decision: "approve" },
                      variant: "default",
                    },
                    {
                      label: "Request changes",
                      action: decideAction,
                      fields: { decision: "request_changes" },
                      needsNote: true,
                    },
                    {
                      label: "Reject",
                      action: decideAction,
                      fields: { decision: "reject" },
                      variant: "ghost",
                    },
                  ]}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  This is not waiting for your approval.
                </p>
              )}
            </CardContent>
          </Card>
          {d.comments.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Comments</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                {d.comments.map((c) => (
                  <p key={c.id}>
                    <span className="text-muted-foreground">{c.author?.name ?? "Someone"}:</span>{" "}
                    {c.body}
                  </p>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
      <p className="mt-6 text-xs">
        <Link href="/portal" className="text-primary underline">
          Back to overview
        </Link>
      </p>
    </>
  );
}
