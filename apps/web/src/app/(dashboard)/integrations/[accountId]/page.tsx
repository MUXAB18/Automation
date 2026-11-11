import Link from "next/link";
import {
  getAccountDetail,
  getProviderDataSummary,
  listAnalyticsSources,
  listProviderSeoProjects,
  listPublishable,
  listPublishingJobs,
} from "@automation/db";
import { getProvider, resolveResources } from "@automation/integrations";
import { notFound } from "next/navigation";
import { DataTable, formatDate } from "@/components/data-table";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ActionButton } from "@/components/integrations/action-button";
import { PublishForm, ReviewActions } from "@/components/integrations/publishing-panel";
import { SourceControls } from "@/components/integrations/google-panel";
import { LinkProjectForm } from "@/components/integrations/seranking-panel";
import { Pagination } from "@/components/pagination";
import { PageHeader } from "@/components/page-header";
import { DevelopmentNotice } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ERROR_HELP,
  HEALTH_LABEL,
  SYNC_MODE_TEXT,
  formatDuration,
  missingScopes,
} from "@/lib/integration-view";
import { getProviders } from "@/lib/providers";
import { requireSection } from "@/lib/sections";
import { requireActor } from "@/lib/session";
import {
  cancelPublishAction,
  selectAnalyticsSourceAction,
  linkSeRankingProjectAction,
  unlinkSeRankingProjectAction,
  disconnectIntegrationAction,
  requestPublishAction,
  resolveReviewAction,
  retryPublishAction,
  retrySyncAction,
  syncNowAction,
  testConnectionAction,
} from "../actions";

export const metadata = { title: "Integration" };

const TRIGGER = {
  schedule: "Scheduled",
  manual: "Manual",
  webhook: "Webhook",
  retry: "Retry",
} as const;

export default async function IntegrationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const actor = await requireActor();
  await requireSection(actor, "integrations");
  const { accountId } = await params;
  const { page } = await searchParams;
  const detail = await getAccountDetail(actor, accountId, Number(page) || 1).catch(() => null);
  if (!detail) notFound();
  const { account, health, runs, canManage, canSync } = detail;
  const provider = getProvider(account.providerKey);
  const missing = provider ? missingScopes(account.scopes, provider.requiredScopes) : [];
  const h = HEALTH_LABEL[health.state];
  const usable = account.status === "active" || account.status === "error";
  const { publishingEnabled } = getProviders();
  const showCrm =
    account.providerKey === "gohighlevel" && !account.isMock && account.status !== "disconnected";
  const crm = showCrm ? await getProviderDataSummary(actor, accountId) : null;
  const publishing = showCrm ? await listPublishingJobs(actor, accountId) : null;
  const publishable =
    showCrm && publishing?.canPublish ? await listPublishable(actor, accountId) : [];
  const showGoogle =
    (account.providerKey === "google_analytics_4" ||
      account.providerKey === "google_search_console") &&
    account.status !== "disconnected";
  const google = showGoogle ? await listAnalyticsSources(actor, accountId) : null;
  const showSeo =
    account.providerKey === "se_ranking" && !account.isMock && account.status !== "disconnected";
  const seo = showSeo ? await listProviderSeoProjects(actor, accountId) : null;
  const seoSummary = showSeo ? await getProviderDataSummary(actor, accountId) : null;
  const features = provider && showCrm ? resolveResources(provider, account.scopes) : null;
  const canPost = account.scopes.includes("socialplanner/post.write");
  const countFor: Record<string, number | undefined> = crm
    ? {
        contacts: crm.counts.contacts,
        opportunities: crm.counts.opportunities,
        pipelines: crm.counts.pipelines,
        conversations: crm.counts.conversations,
        campaigns: crm.counts.campaigns,
        workflows: crm.counts.workflows,
        social_posts: crm.counts.socialPosts,
        social_accounts: crm.socialAccounts.length,
      }
    : {};
  const active = runs.rows.some((r) => r.status === "queued" || r.status === "running");

  return (
    <>
      <PageHeader
        title={account.displayName ?? account.providerName}
        description={`${account.providerName} · connected ${formatDate(account.connectedAt)}${account.connectedByName ? ` by ${account.connectedByName}` : ""}`}
        breadcrumbs={[
          { label: "Integrations", href: "/integrations" },
          { label: account.providerName },
        ]}
        badges={
          <>
            <StatusBadge kind="integration" status={account.status} />
            {account.isMock ? <Badge tone="warning">Development mock</Badge> : null}
          </>
        }
        actions={
          <>
            {canSync ? (
              <>
                <ActionButton
                  action={testConnectionAction}
                  fields={{ accountId }}
                  disabled={account.status === "disconnected"}
                >
                  Test connection
                </ActionButton>
                <ActionButton
                  action={syncNowAction}
                  fields={{ accountId }}
                  variant="default"
                  disabled={!usable || active}
                >
                  Sync now
                </ActionButton>
                {showCrm ? (
                  <ActionButton
                    action={syncNowAction}
                    fields={{ accountId, kind: "full" }}
                    disabled={!usable || active}
                  >
                    Full resync
                  </ActionButton>
                ) : null}
              </>
            ) : null}
          </>
        }
      />

      {account.isMock ? (
        <DevelopmentNotice>
          This is a development mock. Its connection, syncs and rows are simulated and are not live
          data from {account.providerName}.
        </DevelopmentNotice>
      ) : null}

      {account.status === "needs_reauth" || missing.length > 0 ? (
        <Card className="mb-6 border-warning/40">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6 text-sm">
            <p>
              {missing.length > 0
                ? "This connection is missing permissions the platform needs."
                : "The provider rejected this connection. Reconnect to continue syncing."}
            </p>
            {canManage ? (
              <Button asChild size="sm">
                <Link
                  href={`/integrations/connect/${account.providerKey}?client=${account.clientId}`}
                >
                  Reconnect
                </Link>
              </Button>
            ) : (
              <span className="text-muted-foreground">
                Ask someone who manages integrations to reconnect it.
              </span>
            )}
          </CardContent>
        </Card>
      ) : null}

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Provider health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Badge tone={h.tone}>{h.label}</Badge>
            <p className="text-muted-foreground">{health.reason}</p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Success rate</dt>
              <dd>
                {health.successRate === null
                  ? "—"
                  : `${Math.round(health.successRate * 100)}% of ${health.runsConsidered}`}
              </dd>
              <dt className="text-muted-foreground">Last success</dt>
              <dd>{formatDate(health.lastSuccessAt) ?? "—"}</dd>
              <dt className="text-muted-foreground">Last failure</dt>
              <dd>{formatDate(health.lastFailureAt) ?? "—"}</dd>
              <dt className="text-muted-foreground">Average run</dt>
              <dd>{formatDuration(health.avgDurationMs)}</dd>
              <dt className="text-muted-foreground">Rate limits (24h)</dt>
              <dd>{health.rateLimitHits24h}</dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Credentials and permissions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              <span className="text-muted-foreground">Stored credential:</span>{" "}
              {account.status === "disconnected"
                ? "deleted"
                : (account.credentialHint ?? "encrypted")}
            </p>
            <p className="text-xs text-muted-foreground">
              Encrypted at rest and never shown. Updated{" "}
              {formatDate(account.credentialsUpdatedAt) ?? "—"}.
            </p>
            <div>
              <p className="text-muted-foreground">Permissions granted</p>
              {account.scopes.length === 0 ? (
                <p>None recorded</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {account.scopes.map((s) => (
                    <li key={s}>
                      <Badge tone="outline" className="break-all">
                        {s}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
              {missing.length > 0 ? (
                <p className="mt-2 text-warning">Missing: {missing.join(", ")}</p>
              ) : null}
            </div>
            {account.lastTest ? (
              <p>
                <span className="text-muted-foreground">
                  Last test ({formatDate(account.lastTest.at)}):
                </span>{" "}
                {account.lastTest.ok ? "passed" : (account.lastTest.message ?? "failed")}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sync</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{provider ? SYNC_MODE_TEXT[provider.sync.mode] : ""}</p>
            <p>
              <span className="text-muted-foreground">Last synced:</span>{" "}
              {formatDate(account.lastSyncedAt) ?? "never"}
            </p>
            {account.isMock ? (
              <p className="text-muted-foreground">
                Mock accounts only sync when you ask; they are never scheduled.
              </p>
            ) : null}
            {canManage && account.status !== "disconnected" ? (
              <div className="flex flex-wrap gap-2 pt-2">
                <Button asChild size="sm" variant="outline">
                  <Link
                    href={`/integrations/connect/${account.providerKey}?client=${account.clientId}`}
                  >
                    Replace credentials
                  </Link>
                </Button>
                <ConfirmDialog
                  triggerLabel="Disconnect"
                  triggerVariant="destructive"
                  title="Disconnect this account?"
                  description="Stored credentials are deleted and queued syncs are cancelled. Past sync history is kept. You will need to connect again to resume."
                  confirmLabel="Disconnect"
                  destructive
                  action={disconnectIntegrationAction}
                  fields={{ accountId }}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {features && crm ? (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Features</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border text-sm">
                {provider!.resources.map((r) => {
                  const unsupported = features.unsupported.find((u) => u.resource === r);
                  return (
                    <li key={r} className="flex items-start justify-between gap-3 py-2">
                      <span className="font-medium">{r.replaceAll("_", " ")}</span>
                      {unsupported ? (
                        <span className="max-w-xs text-right text-xs text-muted-foreground">
                          <Badge tone="outline">Unsupported</Badge> {unsupported.reason}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {countFor[r] !== undefined
                            ? `${countFor[r]} stored`
                            : r === "social_statistics" && crm.latestStat
                              ? `${crm.latestStat.impressions} impressions (7 days)`
                              : "Supported"}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                Last successful sync: {formatDate(crm.lastSuccessfulSyncAt) ?? "never"}. Contacts
                are re-read in full each time, and conversations are metadata only.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Publishing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {!publishingEnabled ? (
                <p className="text-muted-foreground">
                  Posting is switched off on this server until it has been tested in a sandbox
                  location.
                </p>
              ) : !canPost ? (
                <p className="text-muted-foreground">
                  This connection was made without the <code>socialplanner/post.write</code>{" "}
                  permission. Reconnect and allow posting to publish from here.
                </p>
              ) : !publishing?.canPublish ? (
                <p className="text-muted-foreground">
                  You can see publishing activity but do not have permission to publish.
                </p>
              ) : (
                <PublishForm
                  accountId={accountId}
                  items={publishable}
                  socialAccounts={crm.socialAccounts}
                  action={requestPublishAction}
                />
              )}
              {publishing && publishing.jobs.length > 0 ? (
                <ul className="divide-y divide-border">
                  {publishing.jobs.map((j) => (
                    <li key={j.id} className="py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">{j.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {j.status.replaceAll("_", " ")} · attempt {j.attempts}
                            {j.lastError ? ` · ${j.lastError}` : ""}
                          </p>
                        </div>
                        {publishing.canPublish &&
                        (j.status === "queued" || j.status === "scheduled") ? (
                          <ActionButton
                            action={cancelPublishAction}
                            fields={{ jobId: j.id, accountId }}
                          >
                            Cancel
                          </ActionButton>
                        ) : null}
                        {publishing.canPublish && j.status === "failed" && !j.requestSentAt ? (
                          <ActionButton
                            action={retryPublishAction}
                            fields={{ jobId: j.id, accountId }}
                          >
                            Retry
                          </ActionButton>
                        ) : null}
                      </div>
                      {publishing.canPublish && j.status === "needs_review" ? (
                        <ReviewActions
                          jobId={j.id}
                          accountId={accountId}
                          resolve={resolveReviewAction}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {seo ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>SE Ranking projects</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              Projects are discovered by the sync. Link each one you want to a platform SEO project
              and choose the one search engine whose rankings are tracked; only linked projects have
              their keywords, rankings, audits, competitors and backlinks imported.
            </p>
            {seo.projects.length === 0 ? (
              <p>
                No projects discovered yet. Run a sync, or check that this SE Ranking account has
                projects.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {seo.projects.map((p) => (
                  <li key={p.id} className="space-y-2 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{p.name ?? p.title ?? p.externalId}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.keywordCount ?? "?"} keywords in SE Ranking
                          {!p.providerActive ? " · no longer listed by SE Ranking" : ""}
                          {p.seoProject
                            ? ` · linked to ${p.seoProject.project.name}`
                            : " · not linked"}
                          {p.rankingsThrough
                            ? ` · rankings stored to ${formatDate(p.rankingsThrough)}`
                            : ""}
                        </p>
                      </div>
                      {p.seoProject ? (
                        <div className="flex items-center gap-2">
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/seo/projects/${p.seoProject.id}`}>Open dashboard</Link>
                          </Button>
                          {seo.canLink ? (
                            <ConfirmDialog
                              triggerLabel="Unlink"
                              title="Stop syncing this project?"
                              description="Nothing already imported is deleted. The project just stops receiving updates until it is linked again."
                              confirmLabel="Unlink"
                              action={unlinkSeRankingProjectAction}
                              fields={{ providerProjectId: p.id, accountId }}
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    {!p.seoProject && seo.canLink && p.providerActive ? (
                      <LinkProjectForm
                        accountId={accountId}
                        providerProjectId={p.id}
                        engines={p.engines}
                        candidates={seo.candidates}
                        action={linkSeRankingProjectAction}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {seoSummary &&
            seoSummary.lastSummary.unsupported &&
            seoSummary.lastSummary.unsupported.length > 0 ? (
              <div>
                <p className="font-medium">Not available on this SE Ranking account</p>
                <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                  {seoSummary.lastSummary.unsupported.map((u) => (
                    <li key={u.resource}>
                      <Badge tone="outline">Unsupported</Badge> {u.resource.replaceAll("_", " ")}:{" "}
                      {u.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {google ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>
              {account.providerKey === "google_analytics_4"
                ? "Analytics properties"
                : "Search Console sites"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              Properties are discovered by the sync. Select the ones to track for this client, and
              map each to one of the client&apos;s websites. Nothing is stored for a property until
              it is selected, and numbers appear only after a sync has finished.
            </p>
            {google.sources.length === 0 ? (
              <p>
                No properties discovered yet. Run a sync, or check that the connected Google account
                can see the property.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {google.sources.map((s) => {
                  const unverified = s.metadata.permissionLevel === "siteUnverifiedUser";
                  return (
                    <li key={s.id} className="space-y-2 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">{s.displayName ?? s.externalId}</p>
                          <p className="text-xs text-muted-foreground">
                            {s.externalId}
                            {s.metadata.permissionLevel ? ` · ${s.metadata.permissionLevel}` : ""}
                            {s.metadata.mock ? " · development mock" : ""}
                            {s.dataThrough
                              ? ` · data through ${formatDate(s.dataThrough)}`
                              : s.isActive
                                ? " · not synced yet"
                                : ""}
                          </p>
                          {s.metadata.problem ? (
                            <p className="mt-1 text-xs text-destructive">
                              {s.metadata.problem.message}
                            </p>
                          ) : null}
                        </div>
                        <Badge tone={s.isActive ? "success" : "outline"}>
                          {s.isActive ? "Syncing" : "Not selected"}
                        </Badge>
                      </div>
                      {google.canManage ? (
                        <SourceControls
                          accountId={accountId}
                          sourceId={s.id}
                          active={s.isActive}
                          websiteId={s.websiteId}
                          websites={google.websites}
                          disabledReason={
                            unverified
                              ? "Not verified for this account: Google returns no data"
                              : undefined
                          }
                          action={selectAnalyticsSourceAction}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      <h2 className="mb-3 text-lg font-semibold">Sync history</h2>
      {runs.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No syncs have run yet.</p>
      ) : (
        <>
          <DataTable
            caption="Sync history"
            rows={runs.rows}
            columns={[
              {
                key: "when",
                header: "Started",
                cell: (r) => formatDate(r.startedAt ?? r.createdAt),
              },
              {
                key: "status",
                header: "Status",
                cell: (r) => <StatusBadge kind="run" status={r.status} />,
              },
              {
                key: "trigger",
                header: "Trigger",
                hideOnMobile: true,
                cell: (r) =>
                  `${TRIGGER[r.trigger]}${r.attempt > 1 ? ` (attempt ${r.attempt})` : ""}`,
              },
              {
                key: "duration",
                header: "Took",
                hideOnMobile: true,
                cell: (r) => formatDuration(r.durationMs),
              },
              {
                key: "rows",
                header: "Rows",
                hideOnMobile: true,
                cell: (r) => `${r.rowsFetched} fetched / ${r.rowsWritten} stored`,
              },
              {
                key: "errors",
                header: "Errors",
                cell: (r) =>
                  r.syncErrors.length === 0 ? (
                    "—"
                  ) : (
                    <ul className="space-y-1">
                      {r.syncErrors.map((e) => (
                        <li key={e.id} className="text-xs">
                          <span className="font-medium">{e.message}</span>
                          {ERROR_HELP[e.code] ? (
                            <span className="text-muted-foreground"> {ERROR_HELP[e.code]}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ),
              },
              {
                key: "retry",
                header: "",
                align: "right",
                cell: (r) =>
                  canSync && r.canRetry && usable ? (
                    <ActionButton action={retrySyncAction} fields={{ runId: r.id, accountId }}>
                      Retry
                    </ActionButton>
                  ) : null,
              },
            ]}
          />
          <Pagination
            page={runs.page}
            pageCount={runs.pageCount}
            total={runs.total}
            searchParams={{}}
            basePath={`/integrations/${accountId}`}
          />
        </>
      )}
    </>
  );
}
