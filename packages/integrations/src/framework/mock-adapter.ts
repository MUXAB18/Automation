import { ProviderError, errorFromStatus, toProviderError } from "./errors";
import type {
  ConnectionTestResult,
  Credentials,
  CredentialField,
  NormalizedRecord,
  Page,
  PageRequest,
  ProviderAdapter,
  ProviderDescriptor,
} from "./types";

/**
 * Development stand-in for a provider. It makes no network calls and its records are tagged
 * `source: "mock"` so nothing can present them as real data. The "scenario" credential lets tests and
 * developers exercise every failure path of the shared framework.
 */

export const MOCK_SCENARIOS = [
  { value: "healthy", label: "Works normally" },
  { value: "flaky", label: "Fails once per page, then works (tests retry)" },
  { value: "rate_limited", label: "Always rate limited" },
  { value: "auth_failed", label: "Credentials rejected (tests reconnect)" },
  { value: "partial", label: "Second resource fails (tests partial results)" },
] as const;

const FIELDS: readonly CredentialField[] = [
  {
    name: "scenario",
    label: "Scenario",
    secret: false,
    required: true,
    options: MOCK_SCENARIOS,
    help: "Development mock only: no real provider is contacted and the data is made up.",
  },
];

const PAGE_SIZE = 3;
const PAGES = 2;

export function createMockAdapter(descriptor: ProviderDescriptor): ProviderAdapter {
  // The flaky scenario fails the first call for each cursor, tracked per adapter instance.
  const seen = new Set<string>();
  const scenarioOf = (credentials: Credentials) => credentials.scenario ?? "healthy";

  return {
    descriptor,
    isMock: true,
    credentialFields: FIELDS,

    async testConnection(credentials, ctx): Promise<ConnectionTestResult> {
      const scenario = scenarioOf(credentials);
      if (scenario === "auth_failed") return { ok: false, error: errorFromStatus(401) };
      if (scenario === "rate_limited") return { ok: false, error: errorFromStatus(429, 1) };
      return {
        ok: true,
        externalAccountId: `mock:${descriptor.key}:${ctx.clientId.slice(0, 8)}`,
        displayName: `${descriptor.name} (development mock)`,
        grantedScopes: descriptor.requiredScopes,
      };
    },

    async fetchPage(credentials, request: PageRequest, ctx): Promise<Page<unknown>> {
      const scenario = scenarioOf(credentials);
      if (scenario === "auth_failed") throw errorFromStatus(401);
      if (scenario === "rate_limited") throw errorFromStatus(429, 0.01);
      if (scenario === "partial" && request.resource === descriptor.resources[1])
        throw errorFromStatus(500);
      const key = `${ctx.accountId}:${request.resource}:${request.cursor ?? "start"}`;
      if (scenario === "flaky" && !seen.has(key)) {
        seen.add(key);
        throw errorFromStatus(503);
      }
      const page = request.cursor ? Number(request.cursor) : 0;
      const items = Array.from({ length: PAGE_SIZE }, (_, i) => ({
        id: `${request.resource}-${page * PAGE_SIZE + i + 1}`,
        value: (page * PAGE_SIZE + i + 1) * 10,
      }));
      return { items, nextCursor: page + 1 < PAGES ? String(page + 1) : null };
    },

    normalize(resource, items): NormalizedRecord[] {
      return (items as { id: string; value: number }[]).map((item) => ({
        resource,
        externalId: item.id,
        occurredAt: null,
        data: { value: item.value },
        source: "mock",
      }));
    },

    mapError(error) {
      return error instanceof ProviderError ? error : toProviderError(error);
    },
  };
}
