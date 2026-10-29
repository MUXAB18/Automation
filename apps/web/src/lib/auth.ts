import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { recordSecurityEvent } from "@automation/db";
import { getUnscopedPrisma } from "@automation/db/unsafe";
import { getWebEnv } from "./env";
import { sendMail } from "./mailer";

const env = getWebEnv();
const production = process.env.NODE_ENV === "production";

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export const auth = betterAuth({
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  // Auth tables are not client-owned, so the raw client is correct here.
  database: prismaAdapter(getUnscopedPrisma(), { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    // Accounts are created only through invitations (or the seed script), never self-serve.
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    resetPasswordTokenExpiresIn: 60 * 60,
    // A password change (reset) signs the account out everywhere.
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      // Failures must not change the response (it would reveal which emails exist); log them.
      try {
        await sendMail({
          to: user.email,
          subject: "Reset your password",
          text: `Someone asked to reset the password for this account.\n\nChoose a new password (the link works once and expires in 1 hour):\n${url}\n\nIf this wasn't you, ignore this email: your password has not changed.`,
        });
      } catch (error) {
        console.error(
          "password reset email failed",
          error instanceof Error ? error.message : error,
        );
      }
    },
    onPasswordReset: async ({ user }) => {
      await recordSecurityEvent({
        action: "auth.password_reset_completed",
        actorUserId: user.id,
        entityType: "user",
        entityId: user.id,
      });
    },
  },
  session: {
    expiresIn: SESSION_MAX_AGE_SECONDS,
    // Sliding window: an active user stays signed in, an idle session ends after 7 days.
    updateAge: 60 * 60 * 24,
    // No cookie cache: every request re-reads the session row, so revoking a session or
    // deactivating a user takes effect immediately.
    cookieCache: { enabled: false },
  },
  advanced: {
    database: { generateId: "uuid" },
    // __Secure- prefixed, Secure cookies in production. Cookies are always HttpOnly.
    useSecureCookies: production,
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
  },
  // Applies to requests over HTTP (/api/auth/*). Server actions are throttled in lib/throttle.ts.
  rateLimit: {
    enabled: true,
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/request-password-reset": { window: 3600, max: 5 },
      "/reset-password": { window: 600, max: 10 },
    },
  },
  user: {
    additionalFields: {
      isAdmin: { type: "boolean", defaultValue: false, input: false },
    },
  },
  databaseHooks: {
    session: {
      create: {
        // Deactivated accounts cannot start a session (also covers the reset-password flow).
        before: async (session) => {
          const user = await getUnscopedPrisma().user.findUnique({
            where: { id: session.userId },
            select: { deactivatedAt: true },
          });
          if (!user || user.deactivatedAt) return false;
          return { data: session };
        },
        after: async (session) => {
          await recordSecurityEvent({
            action: "auth.login_succeeded",
            actorUserId: session.userId,
            entityType: "user",
            entityId: session.userId,
            ipAddress: session.ipAddress ?? null,
          });
        },
      },
    },
  },
  plugins: [nextCookies()],
});
