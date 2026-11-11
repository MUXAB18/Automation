/**
 * GoHighLevel (LeadConnector) API v2. Every value here was read from the official documentation
 * (github.com/GoHighLevel/highlevel-api-docs, marketplace.gohighlevel.com/docs); `docs/integrations-gohighlevel.md`
 * lists what was confirmed and what was not.
 */

export const GHL_API_BASE = "https://services.leadconnectorhq.com";
export const GHL_INSTALL_BASE = "https://marketplace.gohighlevel.com";

/** The `Version` header is required on every API call. Most endpoints use this value... */
export const GHL_VERSION = "2021-07-28";
/** ...but the conversations endpoints are documented with this one. */
export const GHL_VERSION_CONVERSATIONS = "2021-04-15";

/** The marketplace app's own credentials (platform-level, from environment variables, never per client). */
export type GhlConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  apiBase?: string;
  installBase?: string;
};

/** Read-only scopes the connection wizard asks for, plus the one write scope publishing needs. */
export const GHL_SCOPES = {
  locations: "locations.readonly",
  contacts: "contacts.readonly",
  opportunities: "opportunities.readonly",
  conversations: "conversations.readonly",
  campaigns: "campaigns.readonly",
  workflows: "workflows.readonly",
  socialAccounts: "socialplanner/account.readonly",
  socialPostsRead: "socialplanner/post.readonly",
  socialPostsWrite: "socialplanner/post.write",
} as const;

export const GHL_READ_SCOPES = [
  GHL_SCOPES.locations,
  GHL_SCOPES.contacts,
  GHL_SCOPES.opportunities,
  GHL_SCOPES.conversations,
  GHL_SCOPES.campaigns,
  GHL_SCOPES.workflows,
  GHL_SCOPES.socialAccounts,
  GHL_SCOPES.socialPostsRead,
] as const;

/** resource -> scopes it needs (all of them). Pipelines come with the opportunities scope. */
export const GHL_RESOURCE_SCOPES: Record<string, readonly string[]> = {
  pipelines: [GHL_SCOPES.opportunities],
  contacts: [GHL_SCOPES.contacts],
  opportunities: [GHL_SCOPES.opportunities],
  conversations: [GHL_SCOPES.conversations],
  campaigns: [GHL_SCOPES.campaigns],
  workflows: [GHL_SCOPES.workflows],
  social_accounts: [GHL_SCOPES.socialAccounts],
  social_posts: [GHL_SCOPES.socialPostsRead],
  // Statistics need the profile ids from the accounts endpoint.
  social_statistics: [GHL_SCOPES.socialAccounts],
};

/** Stored (encrypted) per connected location. */
export type GhlCredentials = {
  accessToken: string;
  refreshToken: string;
  /** ISO time the access token expires. */
  expiresAt: string;
  locationId: string;
  companyId?: string;
  /** The GoHighLevel user the authorisation belongs to; creating a post requires one. */
  userId?: string;
  /** Space-separated scopes granted at install. */
  scope: string;
};

export const grantedScopesOf = (c: Pick<GhlCredentials, "scope">) =>
  c.scope.split(/\s+/).filter(Boolean);
