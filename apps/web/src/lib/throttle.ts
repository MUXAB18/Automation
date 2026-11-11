import "server-only";
import { createHash } from "node:crypto";
import { countSecurityEvents, recordSecurityEvent } from "@automation/db";

/**
 * Database-backed throttling for auth actions. Server actions call Better Auth directly (not over
 * HTTP), which bypasses its built-in rate limiter, so limits are enforced here from the audit log.
 * Works across multiple server instances and survives restarts.
 */

const WINDOW_MS = 15 * 60 * 1000;
export const LIMITS = {
  loginPerEmail: 5,
  loginPerIp: 30,
  resetRequestPerEmail: 3,
  resetRequestPerIp: 10,
} as const;

/** Stable, non-reversible key so the audit log never stores the email a stranger typed. */
export const emailKey = (email: string) =>
  createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32);

export type ThrottleRule = { action: string; perEmail: number; perIp: number; windowMs?: number };

export async function isThrottled(
  rule: ThrottleRule,
  email: string,
  ip: string | null,
): Promise<boolean> {
  const since = new Date(Date.now() - (rule.windowMs ?? WINDOW_MS));
  const [byEmail, byIp] = await Promise.all([
    countSecurityEvents({ action: rule.action, entityId: emailKey(email), since }),
    ip ? countSecurityEvents({ action: rule.action, ipAddress: ip, since }) : Promise.resolve(0),
  ]);
  return byEmail >= rule.perEmail || byIp >= rule.perIp;
}

export const LOGIN_FAILURE = {
  action: "auth.login_failed",
  perEmail: LIMITS.loginPerEmail,
  perIp: LIMITS.loginPerIp,
};
export const RESET_REQUEST = {
  action: "auth.password_reset_requested",
  perEmail: LIMITS.resetRequestPerEmail,
  perIp: LIMITS.resetRequestPerIp,
  windowMs: 60 * 60 * 1000,
};

export function recordAttempt(
  action: string,
  email: string,
  ip: string | null,
  userId?: string | null,
) {
  return recordSecurityEvent({
    action,
    actorUserId: userId ?? null,
    entityType: "auth",
    entityId: emailKey(email),
    ipAddress: ip,
  });
}

/**
 * Per-user quota for expensive or abusable endpoints (PDF rendering, OAuth starts). Counts earlier
 * events for the user in the window, then records this one. Returns false when the quota is used up.
 * Not atomic: concurrent requests can overshoot by a few, which is fine for abuse protection.
 */
export async function consumeUserQuota(
  action: string,
  userId: string,
  limit: number,
  windowMs = WINDOW_MS,
): Promise<boolean> {
  const used = await countSecurityEvents({
    action,
    entityId: userId,
    since: new Date(Date.now() - windowMs),
  });
  if (used >= limit) return false;
  await recordSecurityEvent({
    action,
    actorUserId: userId,
    entityType: "quota",
    entityId: userId,
  });
  return true;
}

export const QUOTAS = {
  reportPdf: { action: "quota.report_pdf", limit: 20, windowMs: 10 * 60 * 1000 },
  oauthStart: { action: "quota.oauth_start", limit: 20, windowMs: 10 * 60 * 1000 },
} as const;
