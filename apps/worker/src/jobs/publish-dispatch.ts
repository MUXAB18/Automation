import {
  claimNextPublishingJob,
  finishPublishingJob,
  loadPublishExecution,
  markPublishRequestSent,
  reapStalePublishingJobs,
  updateAccountCredentials,
  type PublishExecution,
  type PublishOutcome,
  type SecretCipher,
} from "@automation/db";
import type { ProviderError } from "@automation/integrations";
import { defaultRegistry, toProviderError, type AdapterRegistry } from "@automation/integrations";

export const PUBLISH_QUEUE = "social-publishing";
const MAX_JOBS_PER_TICK = 10;

/** Map what the provider did to what the job record needs. Pure, so the rules are testable. */
export function outcomeFromError(error: ProviderError): PublishOutcome {
  if (error.outcomeUnknown)
    return {
      kind: "unknown",
      message:
        "The request may have reached the provider but its answer was not understood. Check whether the post exists before trying again.",
    };
  return {
    kind: "rejected",
    message: error.safeMessage,
    // Only waiting-room errors are worth retrying; a refusal (permissions, validation) will not change.
    retryAfterMs:
      error.code === "rate_limited" || error.code === "quota_exhausted"
        ? (error.retryAfterMs ?? 60_000)
        : undefined,
  };
}

/** Run one claimed job. Never throws. The request is stamped as sent immediately before the call. */
export async function executePublish(
  job: PublishExecution,
  deps: {
    registry: AdapterRegistry;
    publishingEnabled: boolean;
    markSent: (jobId: string) => Promise<void>;
    persistCredentials?: (c: Record<string, string>, expiresAt: string | null) => Promise<void>;
  },
): Promise<PublishOutcome> {
  if (job.isMock)
    return { kind: "rejected", message: "A development mock account cannot publish." };
  if (job.accountStatus !== "active")
    return {
      kind: "rejected",
      message: "The integration account needs attention before it can publish.",
    };
  if (!deps.publishingEnabled)
    return {
      kind: "rejected",
      message: "Publishing through this provider is switched off on this server.",
    };
  let adapter;
  try {
    adapter = deps.registry.get(job.providerKey, "live");
  } catch {
    return { kind: "rejected", message: "A live connection for this provider is not available." };
  }
  if (!adapter.publishPost)
    return { kind: "rejected", message: "This provider does not support publishing." };
  try {
    await deps.markSent(job.jobId);
    const result = await adapter.publishPost(
      job.credentials,
      { targetAccountIds: job.targetAccountIds, text: job.text },
      {
        accountId: job.accountId,
        clientId: job.clientId,
        onCredentialsRefreshed: deps.persistCredentials
          ? (fresh, meta) => deps.persistCredentials!(fresh, meta.expiresAt)
          : undefined,
      },
    );
    return {
      kind: "accepted",
      externalPostId: result.externalPostId,
      providerStatus: result.providerStatus,
    };
  } catch (error) {
    return outcomeFromError(toProviderError(error));
  }
}

export async function runPublishTick(cipher: SecretCipher, publishingEnabled: boolean) {
  const reaped = await reapStalePublishingJobs();
  let executed = 0;
  for (; executed < MAX_JOBS_PER_TICK; executed++) {
    const jobId = await claimNextPublishingJob();
    if (!jobId) break;
    let outcome: PublishOutcome;
    try {
      const job = await loadPublishExecution(jobId, cipher);
      outcome = await executePublish(job, {
        registry: defaultRegistry,
        publishingEnabled,
        markSent: markPublishRequestSent,
        persistCredentials: (credentials, expiresAt) =>
          updateAccountCredentials(job.accountId, credentials, cipher, {
            tokenExpiresAt: expiresAt ? new Date(expiresAt) : null,
          }),
      });
    } catch {
      // Could not even load the job (decryption, data): nothing was sent.
      outcome = { kind: "rejected", message: "The job could not be started." };
    }
    await finishPublishingJob(jobId, outcome);
  }
  return { reaped, executed };
}
