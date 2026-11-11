import type { HealthState } from "@automation/db";

/** Required scopes the account was not granted. */
export const missingScopes = (granted: readonly string[], required: readonly string[]) =>
  required.filter((s) => !granted.includes(s));

/** The development mock is for development and staging; production must opt in explicitly. */
export const mockAllowed = (env: Record<string, string | undefined> = process.env) =>
  env.NODE_ENV !== "production" || env.ALLOW_MOCK_INTEGRATIONS === "1";

export const HEALTH_LABEL: Record<
  HealthState,
  { label: string; tone: "success" | "warning" | "destructive" | "neutral" }
> = {
  healthy: { label: "Healthy", tone: "success" },
  degraded: { label: "Degraded", tone: "warning" },
  failing: { label: "Failing", tone: "destructive" },
  needs_reconnect: { label: "Needs reconnect", tone: "warning" },
  not_synced: { label: "Not synced yet", tone: "neutral" },
  disconnected: { label: "Disconnected", tone: "neutral" },
};

export const SYNC_MODE_TEXT = {
  polling: "Checked on a schedule (the provider offers no push notifications)",
  webhook: "Pushed by the provider (webhooks)",
  polling_and_webhook: "Scheduled checks, plus provider webhooks where installed",
} as const;

export const ERROR_HELP: Record<string, string> = {
  auth_failed: "Reconnect the account.",
  insufficient_scope: "Reconnect and approve the missing permissions.",
  rate_limited: "Retried automatically after a pause.",
  quota_exhausted: "Retried after the provider's quota resets.",
  provider_unavailable: "The provider had a problem; retried automatically.",
  timeout: "Retried automatically.",
  network: "Retried automatically.",
};

export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}
