import type { ProviderError } from "./errors";
import type { RateLimit } from "./rate-limiter";

export type Credentials = Readonly<Record<string, string>>;

export type CredentialField = {
  name: string;
  label: string;
  /** Secret fields are write-only: stored encrypted, never sent back to a browser. */
  secret: boolean;
  required: boolean;
  help?: string;
  /** For non-secret choice fields. */
  options?: readonly { value: string; label: string }[];
};

export type SyncMode = "polling" | "webhook" | "polling_and_webhook";

export type ProviderDescriptor = {
  key: string;
  name: string;
  category: "search" | "analytics" | "seo_data" | "crm";
  authType: "oauth2" | "api_key";
  /** What the provider actually offers; the scheduler uses this, not a wish. */
  sync: { mode: SyncMode; defaultIntervalMinutes: number };
  rateLimit: RateLimit;
  /** OAuth scopes (or API permissions) the platform needs. Compared with what the account was granted. */
  requiredScopes: readonly string[];
  /** Data collections this provider can sync (names are the platform's own, not the provider's). */
  resources: readonly string[];
  /**
   * Scopes a resource needs. A resource whose scopes were not all granted is reported as unsupported
   * for that account instead of being tried. Resources not listed need nothing.
   */
  resourceScopes?: Readonly<Record<string, readonly string[]>>;
  /** Whether the adapter can publish posts (`publishPost`). */
  canPublish?: boolean;
  credentialFields: readonly CredentialField[];
  docsUrl: string;
  /** Plain-language notes shown on the setup screen: what was verified and what is not built yet. */
  notes: readonly string[];
  /** True once a real adapter ships. Until then only the development mock can be connected. */
  live: boolean;
};

export type ConnectionTestResult =
  | { ok: true; externalAccountId: string; displayName: string; grantedScopes: readonly string[] }
  | { ok: false; error: ProviderError };

export type PageRequest = {
  resource: string;
  cursor: string | null;
  /** Only records changed at or after this instant (incremental sync). */
  since: Date | null;
};

export type Page<Raw> = { items: Raw[]; nextCursor: string | null };

export type NormalizedRecord = {
  resource: string;
  /** Stable id from the provider, so writing twice updates instead of duplicating. */
  externalId: string;
  occurredAt: string | null;
  data: Record<string, unknown>;
  /** "mock" records must never be shown as live data. */
  source: "live" | "mock";
};

export type AdapterContext = {
  accountId: string;
  clientId: string;
  signal?: AbortSignal;
  /**
   * Per-account settings the worker loads for the adapter (e.g. which provider projects a person linked).
   * Adapters validate it themselves; absent means "nothing configured yet".
   */
  settings?: unknown;
  /**
   * Called when the adapter obtained new credentials (an OAuth refresh). Providers that rotate refresh
   * tokens invalidate the old one, so the new set MUST be stored before it is used again.
   */
  onCredentialsRefreshed?: (
    credentials: Credentials,
    meta: { expiresAt: string | null },
  ) => Promise<void>;
};

export type PublishRequest = {
  /** Provider-side destination ids (e.g. social profile ids). */
  targetAccountIds: readonly string[];
  text: string;
};

export type PublishResult = {
  externalPostId: string;
  /** What the provider says about the post right after creating it. */
  providerStatus: string | null;
};

/** One provider behind the common interface. Stateless: credentials arrive per call. */
export interface ProviderAdapter {
  readonly descriptor: ProviderDescriptor;
  readonly isMock: boolean;
  /** Fields the setup form asks for. The mock asks for a scenario, not secrets. */
  readonly credentialFields: readonly CredentialField[];
  testConnection(credentials: Credentials, ctx: AdapterContext): Promise<ConnectionTestResult>;
  fetchPage(
    credentials: Credentials,
    request: PageRequest,
    ctx: AdapterContext,
  ): Promise<Page<unknown>>;
  normalize(resource: string, items: unknown[], ctx: AdapterContext): NormalizedRecord[];
  /** Turn anything the adapter's HTTP layer threw into the shared vocabulary. */
  mapError(error: unknown): ProviderError;
  /** Create a post at the provider. Only adapters with `descriptor.canPublish` implement it. */
  publishPost?(
    credentials: Credentials,
    request: PublishRequest,
    ctx: AdapterContext,
  ): Promise<PublishResult>;
}

/** Where normalized records go. The worker provides one that writes to the database. */
export interface SyncSink {
  write(records: NormalizedRecord[], meta: { resource: string }): Promise<number>;
}

export type UnsupportedResource = { resource: string; reason: string };

export type SafeSyncError = {
  code: string;
  message: string;
  retryable: boolean;
  resource: string | null;
};
