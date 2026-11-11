import type { z } from "zod";
import { ProviderError, toProviderError } from "../../framework/errors";
import type {
  AdapterContext,
  ConnectionTestResult,
  Credentials,
  NormalizedRecord,
  Page,
  PageRequest,
  ProviderAdapter,
  PublishRequest,
  PublishResult,
} from "../../framework/types";
import { PROVIDERS } from "../../framework/providers";
import { resolveResources } from "../../framework/resources";
import {
  GHL_RESOURCE_SCOPES,
  GHL_SCOPES,
  GHL_VERSION_CONVERSATIONS,
  grantedScopesOf,
  type GhlConfig,
} from "./config";
import { createGhlHttp, type GhlDeps } from "./http";
import { parseGhlCredentials } from "./oauth";
import * as schemas from "./schemas";

const PAGE = 100; // documented maximum for contacts and opportunities
const POSTS_PAGE = 20; // the posts endpoint documents no maximum, so stay modest
const CONVERSATIONS_PAGE = 20; // documented default
const POSTS_LOOKBACK_DAYS = 90;

type Cursor = { startAfter?: string | number | null; startAfterId?: string | null; skip?: number };
const encode = (c: Cursor) => JSON.stringify(c);
const decode = (raw: string | null): Cursor => {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Cursor;
  } catch {
    return {};
  }
};

const iso = (value: string | number | null | undefined): string | null => {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(typeof value === "number" ? value : value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const invalid = (what: string) =>
  new ProviderError("invalid_response", `GoHighLevel returned ${what} in an unexpected shape.`);

function parse<T extends z.ZodType>(schema: T, data: unknown, what: string): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) throw invalid(what);
  return result.data;
}

/** Page sizes used by the adapter (exposed for tests). */
export const GHL_PAGE_LIMITS = { PAGE, POSTS_PAGE, CONVERSATIONS_PAGE };

export function createGoHighLevelAdapter(config: GhlConfig, deps: GhlDeps = {}): ProviderAdapter {
  const descriptor = PROVIDERS.find((p) => p.key === "gohighlevel")!;
  const http = createGhlHttp(config, deps);
  const now = deps.now ?? (() => new Date());

  const locationOf = (credentials: Credentials) => parseGhlCredentials(credentials).locationId;

  return {
    descriptor: { ...descriptor, live: true },
    isMock: false,
    credentialFields: [],

    async testConnection(credentials, ctx): Promise<ConnectionTestResult> {
      try {
        const creds = parseGhlCredentials(credentials);
        const granted = grantedScopesOf(creds);
        let displayName = `GoHighLevel location ${creds.locationId}`;
        if (granted.includes(GHL_SCOPES.locations)) {
          const body = parse(
            schemas.locationResponse,
            await http.request(credentials, ctx, {
              path: `/locations/${encodeURIComponent(creds.locationId)}`,
            }),
            "the location",
          );
          if (body.location.name) displayName = body.location.name;
        } else if (granted.includes(GHL_SCOPES.contacts)) {
          // No location scope: a one-contact request still proves the token and the location work.
          await http.request(credentials, ctx, {
            path: "/contacts/",
            query: { locationId: creds.locationId, limit: 1 },
          });
        } else if (granted.length === 0) {
          return {
            ok: false,
            error: new ProviderError(
              "insufficient_scope",
              "No permissions were granted to this connection.",
            ),
          };
        }
        return {
          ok: true,
          externalAccountId: creds.locationId,
          displayName,
          grantedScopes: granted,
        };
      } catch (error) {
        return { ok: false, error: toProviderError(error) };
      }
    },

    async fetchPage(credentials, request: PageRequest, ctx): Promise<Page<unknown>> {
      const locationId = locationOf(credentials);
      const granted = grantedScopesOf(parseGhlCredentials(credentials));
      const { unsupported } = resolveResources(descriptor, granted, [request.resource]);
      if (unsupported.length > 0)
        throw new ProviderError("insufficient_scope", unsupported[0]!.reason);
      const cursor = decode(request.cursor);
      const get = (
        path: string,
        query: Record<string, string | number | undefined>,
        version?: string,
      ) => http.request(credentials, ctx, { path, query, version });

      switch (request.resource) {
        case "pipelines": {
          const body = parse(
            schemas.pipelinesResponse,
            await get("/opportunities/pipelines", { locationId }),
            "pipelines",
          );
          return { items: body.pipelines, nextCursor: null };
        }
        case "contacts": {
          // GET /contacts/ is marked deprecated in the spec but is the paginated list that is documented.
          const body = parse(
            schemas.contactsResponse,
            await get("/contacts/", {
              locationId,
              limit: PAGE,
              startAfter: cursor.startAfter ?? undefined,
              startAfterId: cursor.startAfterId ?? undefined,
            }),
            "contacts",
          );
          return {
            items: body.contacts,
            nextCursor: nextFromMeta(body.contacts.length, PAGE, body.meta, "contacts"),
          };
        }
        case "opportunities": {
          const body = parse(
            schemas.opportunitiesResponse,
            await get("/opportunities/search", {
              location_id: locationId,
              limit: PAGE,
              status: "all",
              startAfter: cursor.startAfter ?? undefined,
              startAfterId: cursor.startAfterId ?? undefined,
            }),
            "opportunities",
          );
          return {
            items: body.opportunities,
            nextCursor: nextFromMeta(body.opportunities.length, PAGE, body.meta, "opportunities"),
          };
        }
        case "conversations": {
          const body = parse(
            schemas.conversationsResponse,
            await get(
              "/conversations/search",
              {
                locationId,
                limit: CONVERSATIONS_PAGE,
                sort: "desc",
                sortBy: "last_message_date",
                startAfterDate: cursor.startAfter ?? undefined,
              },
              GHL_VERSION_CONVERSATIONS,
            ),
            "conversations",
          );
          // The documented item schema has no cursor value. Continue only when the API supplied one.
          const last = body.conversations.at(-1)?.lastMessageDate;
          const next =
            body.conversations.length === CONVERSATIONS_PAGE && last != null
              ? encode({ startAfter: last })
              : null;
          return { items: body.conversations, nextCursor: next };
        }
        case "campaigns": {
          const body = parse(
            schemas.campaignsResponse,
            await get("/campaigns/", { locationId }),
            "campaigns",
          );
          return { items: body.campaigns, nextCursor: null };
        }
        case "workflows": {
          const body = parse(
            schemas.workflowsResponse,
            await get("/workflows/", { locationId }),
            "workflows",
          );
          return { items: body.workflows, nextCursor: null };
        }
        case "social_accounts": {
          const body = parse(
            schemas.socialAccountsResponse,
            await get(`/social-media-posting/${encodeURIComponent(locationId)}/accounts`, {}),
            "social accounts",
          );
          return { items: body.results.accounts, nextCursor: null };
        }
        case "social_posts": {
          const skip = cursor.skip ?? 0;
          const to = now();
          const from = request.since ?? new Date(to.getTime() - POSTS_LOOKBACK_DAYS * 86_400_000);
          const body = parse(
            schemas.socialPostsResponse,
            await http.request(credentials, ctx, {
              method: "POST",
              path: `/social-media-posting/${encodeURIComponent(locationId)}/posts/list`,
              body: {
                type: "all",
                skip: String(skip),
                limit: String(POSTS_PAGE),
                fromDate: from.toISOString(),
                toDate: to.toISOString(),
                includeUsers: "false",
              },
            }),
            "social posts",
          );
          const posts = body.results.posts;
          const total = body.results.count ?? 0;
          const next =
            posts.length > 0 && skip + posts.length < total
              ? encode({ skip: skip + posts.length })
              : null;
          return { items: posts, nextCursor: next };
        }
        case "social_statistics": {
          const accounts = parse(
            schemas.socialAccountsResponse,
            await get(`/social-media-posting/${encodeURIComponent(locationId)}/accounts`, {}),
            "social accounts",
          );
          const profileIds = accounts.results.accounts
            .map((a) => a.profileId)
            .filter((id): id is string => Boolean(id));
          if (profileIds.length === 0) return { items: [], nextCursor: null };
          const body = parse(
            schemas.socialStatsResponse,
            await http.request(credentials, ctx, {
              method: "POST",
              path: "/social-media-posting/statistics",
              query: { locationId },
              body: { profileIds },
            }),
            "social statistics",
          );
          return { items: body.results.totals ? [body.results.totals] : [], nextCursor: null };
        }
        default:
          throw new ProviderError(
            "invalid_request",
            `GoHighLevel has no resource named ${request.resource}.`,
          );
      }
    },

    normalize(resource, items): NormalizedRecord[] {
      const rec = (
        externalId: string,
        occurredAt: string | null,
        data: Record<string, unknown>,
      ): NormalizedRecord => ({
        resource,
        externalId,
        occurredAt,
        data,
        source: "live",
      });
      switch (resource) {
        case "pipelines":
          return (items as z.infer<typeof schemas.pipelinesResponse>["pipelines"]).map((p) =>
            rec(p.id, null, {
              name: p.name ?? null,
              stages: (p.stages ?? []).map((st) => ({
                id: st.id,
                name: st.name ?? null,
                position: st.position ?? null,
              })),
            }),
          );
        case "contacts":
          return (items as z.infer<typeof schemas.contactsResponse>["contacts"]).map((c) =>
            rec(c.id, iso(c.dateUpdated ?? c.dateAdded), {
              name:
                c.name ??
                c.contactName ??
                ([c.firstName, c.lastName].filter(Boolean).join(" ") || null),
              firstName: c.firstName ?? null,
              lastName: c.lastName ?? null,
              email: c.email ?? null,
              phone: c.phone ?? null,
              source: c.source ?? null,
              tags: c.tags ?? [],
              externalCreatedAt: iso(c.dateAdded),
              externalUpdatedAt: iso(c.dateUpdated),
            }),
          );
        case "opportunities":
          return (items as z.infer<typeof schemas.opportunitiesResponse>["opportunities"]).map(
            (o) =>
              rec(o.id, iso(o.updatedAt ?? o.createdAt), {
                name: o.name ?? null,
                status: o.status ?? null,
                monetaryValue: o.monetaryValue ?? null,
                pipelineExternalId: o.pipelineId ?? null,
                stageExternalId: o.pipelineStageId ?? null,
                contactExternalId: o.contactId ?? null,
                assignedToExternalId: o.assignedTo ?? null,
                externalCreatedAt: iso(o.createdAt),
                externalUpdatedAt: iso(o.updatedAt),
              }),
          );
        case "conversations":
          return (items as z.infer<typeof schemas.conversationsResponse>["conversations"]).map(
            (c) =>
              rec(c.id, iso(c.lastMessageDate), {
                contactExternalId: c.contactId ?? null,
                type: c.type ?? null,
                lastMessageType: c.lastMessageType ?? null,
                lastMessageAt: iso(c.lastMessageDate),
                unreadCount: c.unreadCount ?? 0,
              }),
          );
        case "campaigns":
          return (items as z.infer<typeof schemas.campaignsResponse>["campaigns"]).map((c) =>
            rec(c.id, null, {
              kind: "campaign",
              name: c.name ?? null,
              status: c.status ?? null,
              version: null,
              externalCreatedAt: null,
              externalUpdatedAt: null,
            }),
          );
        case "workflows":
          return (items as z.infer<typeof schemas.workflowsResponse>["workflows"]).map((w) =>
            rec(w.id, iso(w.updatedAt), {
              kind: "workflow",
              name: w.name ?? null,
              status: w.status ?? null,
              version: w.version ?? null,
              externalCreatedAt: iso(w.createdAt),
              externalUpdatedAt: iso(w.updatedAt),
            }),
          );
        case "social_accounts":
          return (
            items as z.infer<typeof schemas.socialAccountsResponse>["results"]["accounts"]
          ).map((a) =>
            rec(a.id, null, {
              profileExternalId: a.profileId ?? null,
              platform: a.platform ?? null,
              name: a.name ?? null,
              type: a.type ?? null,
              isExpired: a.isExpired ?? false,
            }),
          );
        case "social_posts":
          return (items as z.infer<typeof schemas.socialPostsResponse>["results"]["posts"]).map(
            (p) =>
              rec(p._id, iso(p.publishedAt ?? p.updatedAt), {
                platform: p.platform ?? null,
                summary: p.summary ?? null,
                status: p.status ?? null,
                type: p.type ?? null,
                accountExternalIds: p.accountIds ?? [],
                platformPostId: p.postId ?? null,
                scheduledFor: iso(p.displayDate),
                publishedAt: iso(p.publishedAt),
                providerError: p.error ? p.error.slice(0, 500) : null,
                externalCreatedAt: iso(p.createdAt),
                externalUpdatedAt: iso(p.updatedAt),
              }),
          );
        case "social_statistics":
          return (items as z.infer<typeof schemas.socialStatsResponse>["results"]["totals"][]).map(
            (t) =>
              // One reading per sync; the sink ties it to the sync run, so there is no provider id to dedupe on.
              rec("7d", null, {
                windowDays: 7,
                posts: t?.posts ?? 0,
                likes: t?.likes ?? 0,
                comments: t?.comments ?? 0,
                followers: t?.followers ?? 0,
                impressions: t?.impressions ?? 0,
              }),
          );
        default:
          return [];
      }
    },

    mapError: toProviderError,

    async publishPost(
      credentials,
      request: PublishRequest,
      ctx: AdapterContext,
    ): Promise<PublishResult> {
      const creds = parseGhlCredentials(credentials);
      if (!creds.userId)
        throw new ProviderError(
          "invalid_request",
          "This connection has no GoHighLevel user id, which posting needs. Reconnect the account.",
        );
      if (!grantedScopesOf(creds).includes(GHL_SCOPES.socialPostsWrite))
        throw new ProviderError(
          "insufficient_scope",
          "Posting needs the socialplanner/post.write permission. Reconnect and approve it.",
        );
      const body = parse(
        schemas.createPostResponse,
        await http.request(credentials, ctx, {
          method: "POST",
          path: `/social-media-posting/${encodeURIComponent(creds.locationId)}/posts`,
          body: {
            type: "post",
            accountIds: [...request.targetAccountIds],
            summary: request.text,
            userId: creds.userId,
          },
        }),
        "the created post",
      );
      const id = body.results?.post?._id;
      // The provider answered success but not with an id we can record: we cannot tell what happened.
      if (!id) throw invalid("a created post without an id");
      return { externalPostId: id, providerStatus: body.results?.post?.status ?? null };
    },
  };
}

function nextFromMeta(
  count: number,
  limit: number,
  meta: { startAfterId?: string | null; startAfter?: string | number | null } | null | undefined,
  what: string,
): string | null {
  if (count === 0) return null;
  if (meta?.startAfterId || meta?.startAfter != null)
    return encode({ startAfterId: meta.startAfterId ?? null, startAfter: meta.startAfter ?? null });
  // A full page with no cursor: we cannot know whether more exist. Say so instead of guessing.
  if (count >= limit) throw invalid(`${what} without next-page information`);
  return null;
}

export { GHL_RESOURCE_SCOPES };
