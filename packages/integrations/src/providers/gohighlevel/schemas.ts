import { z } from "zod";

/**
 * Response shapes, written tolerantly: every field the platform stores is optional except the id, and
 * unknown fields are ignored. Only fields named in the official OpenAPI specs are read. A record with
 * no id is skipped (and counted), never invented.
 */

const s = z.string().nullish();
const n = z.number().nullish();

const meta = z
  .object({
    startAfterId: s,
    startAfter: z.union([z.number(), z.string()]).nullish(),
    nextPageUrl: s,
    total: n,
  })
  .nullish();

export const contactsResponse = z.object({
  contacts: z.array(
    z.object({
      id: z.string(),
      firstName: s,
      lastName: s,
      name: s,
      contactName: s,
      email: s,
      phone: s,
      source: s,
      tags: z.array(z.string()).nullish(),
      dateAdded: s,
      dateUpdated: s,
    }),
  ),
  meta,
});

export const opportunitiesResponse = z.object({
  opportunities: z.array(
    z.object({
      id: z.string(),
      name: s,
      status: s,
      monetaryValue: n,
      pipelineId: s,
      pipelineStageId: s,
      contactId: s,
      assignedTo: s,
      createdAt: s,
      updatedAt: s,
    }),
  ),
  meta,
});

export const pipelinesResponse = z.object({
  pipelines: z.array(
    z.object({
      id: z.string(),
      name: s,
      stages: z.array(z.object({ id: z.string(), name: s, position: n })).nullish(),
    }),
  ),
});

export const conversationsResponse = z.object({
  conversations: z.array(
    z.object({
      id: z.string(),
      contactId: s,
      type: s,
      lastMessageType: s,
      // Not in the documented search item schema: used as a pagination cursor only when present.
      lastMessageDate: z.union([z.number(), z.string()]).nullish(),
      unreadCount: n,
    }),
  ),
  total: n,
});

export const campaignsResponse = z.object({
  campaigns: z.array(z.object({ id: z.string(), name: s, status: s })),
});

export const workflowsResponse = z.object({
  workflows: z.array(
    z.object({ id: z.string(), name: s, status: s, version: n, createdAt: s, updatedAt: s }),
  ),
});

export const socialAccountsResponse = z.object({
  results: z.object({
    accounts: z.array(
      z.object({
        id: z.string(),
        profileId: s,
        name: s,
        platform: s,
        type: s,
        isExpired: z.boolean().nullish(),
      }),
    ),
  }),
});

export const socialPostsResponse = z.object({
  results: z.object({
    posts: z.array(
      z.object({
        _id: z.string(),
        summary: s,
        status: s,
        type: s,
        platform: s,
        accountIds: z.array(z.string()).nullish(),
        postId: s,
        publishedAt: s,
        displayDate: s,
        createdAt: s,
        updatedAt: s,
        error: s,
      }),
    ),
    count: n,
  }),
});

export const socialStatsResponse = z.object({
  results: z.object({
    totals: z
      .object({
        posts: n,
        likes: n,
        followers: n,
        impressions: n,
        comments: n,
      })
      .nullish(),
  }),
});

// The documented 201 response of "create post" is inferred from the spec's schema names; `_id` is the
// only thing relied on, and a missing one is treated as "outcome unknown".
export const createPostResponse = z.object({
  results: z
    .object({ post: z.object({ _id: z.string().optional(), status: s }).nullish() })
    .nullish(),
});

export const locationResponse = z.object({
  location: z.object({ id: z.string().optional(), name: s, timezone: s }),
});
