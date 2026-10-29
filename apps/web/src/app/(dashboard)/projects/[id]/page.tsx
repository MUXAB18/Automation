import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "@automation/db";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { dash, formatDate } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { SampleBadge } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadProject } from "@/lib/cached";
import { requireSection } from "@/lib/sections";
import { requireActor } from "@/lib/session";
import { projectStatusConfirmAction } from "../actions";

export const metadata = { title: "Project" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>
);

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  await requireSection(actor, "projects");
  const { id } = await params;
  let d;
  try {
    d = await loadProject(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { project } = d;
  const archived = project.status === "archived";
  const date = (v: Date | null) => formatDate(v);

  return (
    <>
      <PageHeader
        title={project.name}
        description={project.description ?? undefined}
        breadcrumbs={[{ label: "Projects", href: "/projects" }, { label: project.name }]}
        badges={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="project" status={project.status} />
            <Badge tone="outline" className="capitalize">
              {project.kind}
            </Badge>
            <SampleBadge show={project.isSample} />
          </span>
        }
        actions={
          d.canManage ? (
            <>
              <Button asChild variant="outline">
                <Link href={`/projects/${id}/edit`}>Edit</Link>
              </Button>
              <ConfirmDialog
                triggerLabel={archived ? "Restore" : "Archive"}
                triggerVariant="outline"
                triggerSize="default"
                triggerClassName={archived ? undefined : "text-destructive"}
                title={archived ? `Restore ${project.name}?` : `Archive ${project.name}?`}
                description={
                  archived
                    ? "The project becomes active again."
                    : "The project leaves the default list and selectors. Tasks, content, keywords and history are kept, and you can restore it any time."
                }
                confirmLabel={archived ? "Restore project" : "Archive project"}
                destructive={!archived}
                action={projectStatusConfirmAction}
                fields={{ projectId: id, status: archived ? "active" : "archived" }}
              />
            </>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-border">
              <Row label="Client">
                <Link
                  href={`/clients/${project.client.id}`}
                  className="font-medium hover:underline"
                >
                  {project.client.name}
                </Link>
              </Row>
              <Row label="Dates">
                {project.startsOn || project.endsOn ? (
                  `${date(project.startsOn) ?? "…"} – ${date(project.endsOn) ?? "ongoing"}`
                ) : (
                  <span className="text-muted-foreground">Not set</span>
                )}
              </Row>
              <Row label="Goals">
                {project.goals ? (
                  <p className="whitespace-pre-wrap">{project.goals}</p>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </Row>
              <Row label="Created">
                {date(project.createdAt)}
                {project.createdBy ? ` by ${project.createdBy.name}` : ""}
              </Row>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>People ({project.projectMemberships.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {project.projectMemberships.length === 0 ? (
              <Empty>Nobody is assigned yet.</Empty>
            ) : (
              <ul className="divide-y divide-border">
                {project.projectMemberships.map((m) => (
                  <li
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                  >
                    <span>
                      <span className="font-medium">
                        {m.clientMembership.agencyMembership.user.name}
                      </span>{" "}
                      <span className="text-muted-foreground">
                        {m.clientMembership.agencyMembership.user.email}
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {m.clientMembership.roles.map((r) => (
                        <Badge key={r.role.name} tone="outline">
                          {r.role.name}
                        </Badge>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {d.seo ? (
          <Card>
            <CardHeader>
              <CardTitle>SEO targets</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-border">
                <Row label="Website">{project.seoProject?.website.domain}</Row>
                <Row label="Market">
                  {project.seoProject?.targetCountry} · {project.seoProject?.targetLanguage}
                </Row>
                <Row label="Organic sessions">
                  {dash(d.seo.targets.organicSessionsGoal?.toLocaleString("en-CA"))}{" "}
                  <span className="text-muted-foreground">goal per month</span>
                </Row>
                <Row label="Top-10 keywords">
                  {dash(d.seo.targets.topTenKeywordsGoal)}{" "}
                  <span className="text-muted-foreground">goal</span>
                </Row>
                <Row label="Tracked rank">
                  {d.seo.rankedCount > 0 ? (
                    `${d.seo.avgPosition?.toFixed(1)} average position across ${d.seo.rankedCount} ranked keywords`
                  ) : (
                    <span className="text-muted-foreground">
                      No ranking data yet (needs a connected provider)
                    </span>
                  )}
                </Row>
              </dl>
              {d.seo.keywords ? (
                d.seo.keywords.length === 0 ? (
                  <Empty>No keywords tracked.</Empty>
                ) : (
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {d.seo.keywords.map((k) => (
                      <li key={k.id}>
                        <Badge
                          tone="outline"
                          title={
                            k.keywordRankSnapshots[0]?.position
                              ? `Position ${Number(k.keywordRankSnapshots[0].position).toFixed(1)}`
                              : "No rank yet"
                          }
                        >
                          {k.term}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {d.social ? (
          <Card>
            <CardHeader>
              <CardTitle>Social media requirements</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-border">
                <Row label="Channels">
                  <span className="flex flex-wrap gap-1">
                    {d.social.channels.map((c) => (
                      <Badge key={c} tone="outline">
                        {c.replace(/_/g, " ")}
                      </Badge>
                    ))}
                  </span>
                </Row>
                <Row label="Frequency">{d.social.postsPerWeek} posts per week</Row>
                <Row label="Requirements">
                  {d.social.requirements ? (
                    <p className="whitespace-pre-wrap">{d.social.requirements}</p>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </Row>
              </dl>
            </CardContent>
          </Card>
        ) : null}

        {d.tasks ? (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Open tasks ({d.tasks.open.length})</CardTitle>
              <Link href="/tasks?open=1" className="text-xs text-primary hover:underline">
                All tasks
              </Link>
            </CardHeader>
            <CardContent>
              {d.tasks.open.length === 0 ? (
                <Empty>No open tasks.</Empty>
              ) : (
                <ul className="divide-y divide-border">
                  {d.tasks.open.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-medium">
                          <span className="truncate">{t.title}</span>{" "}
                          <SampleBadge show={t.isSample} />
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t.assignee?.name ?? "Unassigned"}
                          {t.dueAt ? ` · due ${formatDate(t.dueAt)}` : ""}
                        </p>
                      </div>
                      <StatusBadge kind="task" status={t.status} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}

        {d.content ? (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Content ({d.content.items.length})</CardTitle>
              <Link href="/content" className="text-xs text-primary hover:underline">
                Calendar
              </Link>
            </CardHeader>
            <CardContent>
              {d.content.items.length === 0 ? (
                <Empty>No content linked to this project.</Empty>
              ) : (
                <ul className="divide-y divide-border">
                  {d.content.items.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-medium">
                          <span className="truncate">{c.title}</span>{" "}
                          <SampleBadge show={c.isSample} />
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {c.channel}
                          {c.scheduledFor ? ` · ${formatDate(c.scheduledFor)}` : ""}
                        </p>
                      </div>
                      <StatusBadge kind="content" status={c.status} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}

        {d.seo?.issues ? (
          <Card>
            <CardHeader>
              <CardTitle>SEO issues ({d.seo.issues.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {d.seo.issues.length === 0 ? (
                <Empty>No open issues. Findings from site audits will appear here.</Empty>
              ) : (
                <ul className="divide-y divide-border">
                  {d.seo.issues.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                      <span className="truncate font-medium">{i.title}</span>
                      <span className="flex gap-2">
                        <StatusBadge kind="severity" status={i.severity} />
                        <StatusBadge kind="issue" status={i.status} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}

        {d.metrics ? (
          <Card>
            <CardHeader>
              <CardTitle>Metrics</CardTitle>
            </CardHeader>
            <CardContent>
              {d.metrics.sources.length === 0 ? (
                <Empty>
                  No analytics source is connected to this project&rsquo;s website yet, so there are
                  no metrics to show.
                </Empty>
              ) : (
                <>
                  <ul className="divide-y divide-border">
                    {d.metrics.sources.map((s) => (
                      <li
                        key={s.id}
                        className="flex items-center justify-between gap-3 py-3 text-sm"
                      >
                        <span className="font-medium">{s.displayName ?? s.externalId}</span>
                        <span className="text-xs text-muted-foreground">
                          last synced {formatDate(s.lastSyncedAt) ?? "never"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {d.metrics.snapshotCount} stored readings.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        ) : null}

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {d.activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {d.activity.map((entry) => (
                  <li key={entry.id} className="flex items-baseline justify-between gap-3">
                    <span>
                      <code className="text-xs">{entry.action}</code>{" "}
                      <span className="text-muted-foreground">
                        by {entry.actor?.name ?? "system"}
                      </span>
                    </span>
                    <time
                      className="shrink-0 text-xs text-muted-foreground"
                      dateTime={entry.createdAt.toISOString()}
                    >
                      {entry.createdAt.toLocaleString("en-CA", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
