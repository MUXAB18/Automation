"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  cancelPublish,
  setAnalyticsSourceSelection,
  linkProviderSeoProject,
  connectAccount,
  disconnectAccount,
  queueSync,
  recordConnectionTest,
  updateAccountCredentials,
  requestPublish,
  requirePermission,
  resolvePublishReview,
  retryPublish,
  retrySync,
  unlinkProviderSeoProject,
  withAccountCredentials,
} from "@automation/db";
import {
  MOCK_SCENARIOS,
  ProviderError,
  getProvider,
  toProviderError,
  GA4_SCOPE,
  GSC_SCOPE,
  parseServiceAccountKey,
  type AdapterContext,
  type ConnectionTestResult,
  type ProviderAdapter,
} from "@automation/integrations";
import { errorMessage, toFormState, type FormState } from "@/lib/action-state";
import { getCipher } from "@/lib/cipher";
import { getProviders } from "@/lib/providers";
import { mockAllowed, missingScopes } from "@/lib/integration-view";
import { requireActor } from "@/lib/session";

export type Result = { error?: string; success?: string };

const refresh = (accountId?: string) => {
  revalidatePath("/integrations", "layout");
  if (accountId) revalidatePath(`/integrations/${accountId}`);
};
const field = (data: FormData, name: string) => {
  const v = data.get(name);
  return typeof v === "string" ? v.trim() : "";
};

/** Adapter for a stored account, or a clear reason there is none. */
function adapterFor(providerKey: string, isMock: boolean): ProviderAdapter {
  if (isMock && !mockAllowed())
    throw new ProviderError("invalid_request", "The development mock is switched off here.");
  if (!isMock && !getProviders().registry.hasLive(providerKey))
    throw new ProviderError(
      "invalid_request",
      "A live connection for this provider is not available yet.",
    );
  return getProviders().registry.get(providerKey, isMock ? "mock" : "live");
}

/** Run the provider's own check, then require that every needed scope was actually granted. */
async function checkConnection(
  adapter: ProviderAdapter,
  credentials: Record<string, string>,
  ctx: AdapterContext,
): Promise<ConnectionTestResult> {
  let result: ConnectionTestResult;
  try {
    result = await adapter.testConnection(credentials, ctx);
  } catch (error) {
    return { ok: false, error: adapter.mapError(error) };
  }
  if (!result.ok) return result;
  const missing = missingScopes(result.grantedScopes, adapter.descriptor.requiredScopes);
  if (missing.length > 0)
    return {
      ok: false,
      error: new ProviderError(
        "insufficient_scope",
        "The connection is missing permissions this feature needs. Reconnect and approve them.",
      ),
    };
  return result;
}

// ---- Connect / reconnect ----------------------------------------------------------------------

export async function connectIntegrationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  const clientId = field(formData, "clientId");
  const providerKey = field(formData, "providerKey");
  let accountId: string;
  try {
    // Authorise BEFORE talking to the provider: a person without access must not trigger calls.
    await requirePermission(actor, clientId, "integration.manage");
    const provider = getProvider(providerKey);
    if (!provider) return { error: "Unknown provider" };

    const wantsMock = field(formData, "mode") !== "live";
    const adapter = wantsMock ? adapterFor(providerKey, true) : adapterFor(providerKey, false);

    const credentials: Record<string, string> = {};
    for (const f of adapter.credentialFields) {
      const value = field(formData, f.name);
      if (!value && f.required)
        return { error: `${f.label} is required`, fieldErrors: { [f.name]: ["Required"] } };
      if (value) credentials[f.name] = value;
    }
    if (adapter.isMock && !MOCK_SCENARIOS.some((s) => s.value === credentials.scenario))
      return { error: "Choose a scenario", fieldErrors: { scenario: ["Choose one"] } };

    const probe = await checkConnection(adapter, credentials, { accountId: "setup", clientId });
    if (!probe.ok) return { error: probe.error.safeMessage };

    ({ id: accountId } = await connectAccount(
      actor,
      {
        clientId,
        integrationKey: providerKey,
        externalAccountId: probe.externalAccountId,
        displayName: probe.displayName,
        credentials,
        scopes: [...probe.grantedScopes],
        mock: adapter.isMock,
        hintField: adapter.credentialFields.find((f) => f.secret)?.name,
      },
      getCipher(),
    ));
  } catch (error) {
    if (error instanceof ProviderError) return { error: error.safeMessage };
    return toFormState(error);
  }
  refresh();
  redirect(`/integrations/${accountId}`);
}

// ---- Test / sync / retry / disconnect ----------------------------------------------------------------

export async function testConnectionAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  const accountId = field(formData, "accountId");
  try {
    const outcome = await withAccountCredentials(
      actor,
      accountId,
      "integration.sync",
      getCipher(),
      async (credentials, account) => {
        try {
          const adapter = adapterFor(account.providerKey, account.isMock);
          return await checkConnection(adapter, credentials, {
            accountId,
            clientId: account.clientId,
            // A refresh rotates the provider's refresh token: store it before anything else uses it.
            onCredentialsRefreshed: (fresh, meta) =>
              updateAccountCredentials(accountId, fresh, getCipher(), {
                tokenExpiresAt: meta.expiresAt ? new Date(meta.expiresAt) : null,
              }),
          });
        } catch (error) {
          return { ok: false as const, error: toProviderError(error) };
        }
      },
    );
    await recordConnectionTest(
      actor,
      accountId,
      outcome.ok
        ? { ok: true }
        : {
            ok: false,
            code: outcome.error.code,
            message: outcome.error.safeMessage,
            needsReconnect: outcome.error.needsReconnect,
          },
    );
    refresh(accountId);
    return outcome.ok ? { success: "Connection works" } : { error: outcome.error.safeMessage };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function syncNowAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  try {
    const kind = field(formData, "kind") === "full" ? "full" : "manual";
    await queueSync(actor, field(formData, "accountId"), kind);
    refresh(field(formData, "accountId"));
    return { success: "Sync queued. The worker will pick it up shortly" };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function retrySyncAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  try {
    await retrySync(actor, field(formData, "runId"));
    refresh(field(formData, "accountId"));
    return { success: "Retry queued" };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function disconnectIntegrationAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  try {
    await disconnectAccount(actor, field(formData, "accountId"), getCipher());
    refresh(field(formData, "accountId"));
    return { success: "Disconnected. Stored credentials were deleted" };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

// ---- Publishing ----------------------------------------------------------------------------------

export async function requestPublishAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  const accountId = field(formData, "accountId");
  try {
    // Posting stays off until it has been verified against a real account (GHL_PUBLISHING_ENABLED).
    if (!getProviders().publishingEnabled)
      return { error: "Posting is switched off on this server." };
    await requestPublish(actor, {
      integrationAccountId: accountId,
      contentItemId: field(formData, "contentItemId"),
      targetAccountIds: formData
        .getAll("targetAccountIds")
        .filter((v): v is string => typeof v === "string"),
    });
  } catch (error) {
    return toFormState(error);
  }
  refresh(accountId);
  return { ok: true, message: "Queued. The worker will publish it shortly" };
}

export async function cancelPublishAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  try {
    await cancelPublish(actor, field(formData, "jobId"));
    refresh(field(formData, "accountId"));
    return { success: "Cancelled" };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function retryPublishAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  try {
    await retryPublish(actor, field(formData, "jobId"));
    refresh(field(formData, "accountId"));
    return { success: "Queued again" };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

/** A person checked GoHighLevel for a job whose outcome was unclear and reports what they found. */
export async function resolveReviewAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  try {
    const posted = field(formData, "outcome") === "posted";
    await resolvePublishReview(
      actor,
      field(formData, "jobId"),
      posted
        ? { outcome: "posted", externalPostId: field(formData, "externalPostId") }
        : { outcome: "not_posted" },
    );
    refresh(field(formData, "accountId"));
    return { success: posted ? "Recorded as posted" : "Recorded as not posted. You can retry it" };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

// ---- SE Ranking project linking ------------------------------------------------------------------

/** Link a discovered SE Ranking project to a platform SEO project, then queue a sync so data arrives soon. */
export async function linkSeRankingProjectAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  const accountId = field(formData, "accountId");
  try {
    await linkProviderSeoProject(actor, {
      providerProjectId: field(formData, "providerProjectId"),
      seoProjectId: field(formData, "seoProjectId"),
      siteEngineId: Number(field(formData, "siteEngineId")),
    });
  } catch (error) {
    return toFormState(error);
  }
  // The first sync after linking reads the ranking backfill. Failing to queue it (already running) is fine.
  await queueSync(actor, accountId, "manual").catch(() => undefined);
  refresh(accountId);
  revalidatePath("/seo", "layout");
  return { ok: true, message: "Linked. A sync was queued to import its data" };
}

export async function unlinkSeRankingProjectAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  try {
    await unlinkProviderSeoProject(actor, field(formData, "providerProjectId"));
    refresh(field(formData, "accountId"));
    revalidatePath("/seo", "layout");
    return { success: "Unlinked. Imported data was kept" };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

// ---- Google: service account and property selection -----------------------------------------------

const GOOGLE_SCOPE: Record<string, string> = {
  google_analytics_4: GA4_SCOPE,
  google_search_console: GSC_SCOPE,
};

/** Connect with a service account key. The key is validated, tested and stored encrypted; it is never shown again. */
export async function connectGoogleServiceAccountAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActor();
  const clientId = field(formData, "clientId");
  const providerKey = field(formData, "providerKey");
  let accountId: string;
  try {
    await requirePermission(actor, clientId, "integration.manage");
    if (!GOOGLE_SCOPE[providerKey]) return { error: "Unknown provider" };
    const key = parseServiceAccountKey(String(formData.get("key") ?? ""));
    const credentials = {
      kind: "service_account",
      clientEmail: key.clientEmail,
      privateKey: key.privateKey,
    };
    const adapter = adapterFor(providerKey, false);
    const probe = await checkConnection(adapter, credentials, { accountId: "setup", clientId });
    if (!probe.ok) return { error: probe.error.safeMessage };
    ({ id: accountId } = await connectAccount(
      actor,
      {
        clientId,
        integrationKey: providerKey,
        externalAccountId: probe.externalAccountId,
        displayName: `${probe.displayName} · service account`,
        credentials,
        scopes: [...probe.grantedScopes],
        mock: false,
      },
      getCipher(),
    ));
  } catch (error) {
    if (error instanceof ProviderError) return { error: error.safeMessage };
    return toFormState(error);
  }
  refresh();
  redirect(`/integrations/${accountId}`);
}

/** Select (or deselect) a discovered property and map it to a website; selecting queues a sync so data arrives soon. */
export async function selectAnalyticsSourceAction(formData: FormData): Promise<Result> {
  const actor = await requireActor();
  const accountId = field(formData, "accountId");
  const active = field(formData, "active") === "1";
  try {
    await setAnalyticsSourceSelection(actor, {
      sourceId: field(formData, "sourceId"),
      active,
      websiteId: field(formData, "websiteId") || null,
    });
    if (active) await queueSync(actor, accountId, "manual").catch(() => undefined);
    refresh(accountId);
    revalidatePath("/analytics", "layout");
    return {
      success: active
        ? "Selected. A sync was queued to import its data"
        : "Deselected. Stored data was kept",
    };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}
