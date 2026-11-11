import { z } from "zod";
import { requirePermission, type Actor } from "../access";
import { recordAudit } from "../audit";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import type { Prisma } from "../generated/client";
import type { Permission } from "../rbac";
import { can } from "../permissions";
import { parseInput } from "../schemas";
import { getUnscopedPrisma } from "../unsafe";
import { deriveHealth, type HealthRun } from "./integration-health";
import { PAGE_SIZE, clampPage, paged } from "./paging";

/**
 * Integration accounts, credentials and sync runs.
 *
 * Secrets: credentials are encrypted before they reach the database (the cipher is injected, so this
 * package stays free of provider code) and are only ever decrypted inside `withAccountCredentials`
 * or `loadRunForExecution`. No function here returns ciphertext or plaintext to a caller that
 * could pass it to a browser: views are built from explicit field lists.
 */

export type SecretCipher = {
  encrypt(plaintext: string, context: string): string;
  decrypt(payload: string, context: string): string;
};

type Tx = Prisma.TransactionClient;
const prismaClient = () => getUnscopedPrisma();

const credentialContext = (clientId: string, providerKey: string) => `${clientId}:${providerKey}`;

/** Safe to show: only the last four characters of a long secret. */
export function makeCredentialHint(value: string | undefined): string | null {
  return value && value.length >= 12 ? `••••${value.slice(-4)}` : null;
}

export const SYNC_KINDS = ["incremental", "backfill", "full", "manual"] as const;
const ACTIVE_RUN = ["queued", "running"] as const;

const credentialsSchema = z
  .record(z.string().min(1).max(64), z.string().max(8192))
  .refine((c) => Object.keys(c).length <= 20, "Too many credential fields");

const connectSchema = z.object({
  clientId: z.uuid(),
  integrationKey: z.string().min(1).max(64),
  externalAccountId: z.string().trim().min(1).max(255),
  displayName: z.string().trim().max(200).nullish(),
  credentials: credentialsSchema,
  scopes: z.array(z.string().max(300)).max(50).default([]),
  mock: z.boolean().default(false),
  tokenExpiresAt: z.date().nullish(),
  /** Which credential field to derive the masked hint from. */
  hintField: z.string().max(64).optional(),
});
export type ConnectAccountInput = z.input<typeof connectSchema>;

// ---- Views (explicit field lists: nothing secret can slip in) --------------------------------------

const ACCOUNT_SELECT = {
  id: true,
  clientId: true,
  integrationId: true,
  externalAccountId: true,
  displayName: true,
  status: true,
  scopes: true,
  tokenExpiresAt: true,
  lastSyncedAt: true,
  lastErrorAt: true,
  disconnectedAt: true,
  createdAt: true,
  metadata: true,
  integration: { select: { key: true, name: true, category: true, authType: true } },
  connectedBy: { select: { name: true } },
} satisfies Prisma.IntegrationAccountSelect;

type AccountRow = Prisma.IntegrationAccountGetPayload<{ select: typeof ACCOUNT_SELECT }>;

type AccountMeta = {
  mock?: boolean;
  credentialHint?: string | null;
  credentialsUpdatedAt?: string;
  lastTest?: { at: string; ok: boolean; code?: string; message?: string };
};

export function toAccountView(row: AccountRow) {
  const meta = (row.metadata ?? {}) as AccountMeta;
  return {
    id: row.id,
    clientId: row.clientId,
    providerKey: row.integration.key,
    providerName: row.integration.name,
    category: row.integration.category,
    authType: row.integration.authType,
    externalAccountId: row.externalAccountId,
    displayName: row.displayName,
    status: row.status,
    scopes: row.scopes,
    isMock: meta.mock === true,
    credentialHint: meta.credentialHint ?? null,
    credentialsUpdatedAt: meta.credentialsUpdatedAt ? new Date(meta.credentialsUpdatedAt) : null,
    lastTest: meta.lastTest ? { ...meta.lastTest, at: new Date(meta.lastTest.at) } : null,
    tokenExpiresAt: row.tokenExpiresAt,
    lastSyncedAt: row.lastSyncedAt,
    lastErrorAt: row.lastErrorAt,
    disconnectedAt: row.disconnectedAt,
    connectedAt: row.createdAt,
    connectedByName: row.connectedBy?.name ?? null,
  };
}
export type AccountView = ReturnType<typeof toAccountView>;

async function loadAccountScope(accountId: string) {
  const row = await prismaClient().integrationAccount.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      clientId: true,
      agencyId: true,
      status: true,
      metadata: true,
      integration: { select: { key: true } },
    },
  });
  if (!row) throw new NotFoundError("Integration account not found");
  return row;
}

/** Authorise against the account's client. Unknown id and no access look identical (NotFound). */
async function authorizeAccount(actor: Actor, accountId: string, permission: Permission) {
  const account = await loadAccountScope(accountId);
  const ctx = await requirePermission(actor, account.clientId, permission);
  return { account, ctx };
}

// ---- Reads -----------------------------------------------------------------------------------------

export async function getClientIntegrations(actor: Actor, clientId: string) {
  const ctx = await requirePermission(actor, clientId, "integration.view");
  const [catalogue, rows, activeRuns] = await Promise.all([
    prismaClient().integration.findMany({
      where: { isEnabled: true },
      select: { id: true, key: true, name: true, category: true, authType: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    ctx.db.integrationAccount.findMany({
      where: { clientId },
      select: ACCOUNT_SELECT,
      orderBy: { createdAt: "asc" },
    }),
    ctx.db.syncRun.findMany({
      where: { clientId, status: { in: [...ACTIVE_RUN] } },
      select: { integrationAccountId: true, status: true },
    }),
  ]);
  const active = new Map(activeRuns.map((r) => [r.integrationAccountId, r.status]));
  return {
    catalogue,
    accounts: rows.map((r) => ({ ...toAccountView(r), activeRun: active.get(r.id) ?? null })),
    canManage: can(ctx.access, "integration.manage"),
    canSync: can(ctx.access, "integration.sync"),
  };
}

export async function getAccountDetail(actor: Actor, accountId: string, page?: number) {
  const { account, ctx } = await authorizeAccount(actor, accountId, "integration.view");
  const current = clampPage(page);
  const [row, runs, total, healthRuns] = await Promise.all([
    ctx.db.integrationAccount.findFirstOrThrow({
      where: { id: accountId },
      select: ACCOUNT_SELECT,
    }),
    ctx.db.syncRun.findMany({
      where: { integrationAccountId: accountId },
      orderBy: { createdAt: "desc" },
      skip: (current - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        kind: true,
        trigger: true,
        status: true,
        attempt: true,
        rowsFetched: true,
        rowsWritten: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true,
        syncErrors: {
          select: { id: true, code: true, message: true, retryable: true, occurredAt: true },
          orderBy: { occurredAt: "asc" },
        },
      },
    }),
    ctx.db.syncRun.count({ where: { integrationAccountId: accountId } }),
    ctx.db.syncRun.findMany({
      where: { integrationAccountId: accountId },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        status: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true,
        syncErrors: { select: { code: true } },
      },
    }),
  ]);
  const view = toAccountView(row);
  const health = deriveHealth(
    { status: view.status },
    healthRuns.map<HealthRun>((r) => ({ ...r, errorCodes: r.syncErrors.map((e) => e.code) })),
  );
  const latestId = runs[0]?.id;
  return {
    account: view,
    health,
    runs: paged(
      runs.map((r) => ({
        ...r,
        durationMs:
          r.startedAt && r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null,
        canRetry:
          current === 1 &&
          r.id === latestId &&
          ["failed", "partial", "cancelled"].includes(r.status),
      })),
      total,
      current,
    ),
    canManage: can(ctx.access, "integration.manage"),
    canSync: can(ctx.access, "integration.sync"),
    clientId: account.clientId,
  };
}

// ---- Connect / reconnect / disconnect --------------------------------------------------------------

async function integrationByKey(tx: Tx, key: string) {
  const integration = await tx.integration.findUnique({
    where: { key },
    select: { id: true, key: true, isEnabled: true },
  });
  if (!integration || !integration.isEnabled)
    throw new ValidationError({ integrationKey: ["Unknown or disabled integration"] });
  return integration;
}

function accountMeta(
  input: { mock: boolean; hint: string | null },
  previous?: object,
): Prisma.InputJsonObject {
  return {
    ...(previous as Prisma.InputJsonObject | undefined),
    mock: input.mock,
    credentialHint: input.hint,
    credentialsUpdatedAt: new Date().toISOString(),
  };
}

/**
 * Store a connection the caller has ALREADY tested. Connecting again with the same provider account
 * is the reconnection flow: credentials are replaced and the account becomes active.
 */
export async function connectAccount(actor: Actor, raw: ConnectAccountInput, cipher: SecretCipher) {
  const input = parseInput(connectSchema, raw);
  const ctx = await requirePermission(actor, input.clientId, "integration.manage");
  return prismaClient().$transaction(async (tx) => {
    const integration = await integrationByKey(tx, input.integrationKey);
    const encrypted = cipher.encrypt(
      JSON.stringify(input.credentials),
      credentialContext(input.clientId, integration.key),
    );
    const hint = makeCredentialHint(
      input.hintField ? input.credentials[input.hintField] : undefined,
    );
    const existing = await tx.integrationAccount.findUnique({
      where: {
        clientId_integrationId_externalAccountId: {
          clientId: input.clientId,
          integrationId: integration.id,
          externalAccountId: input.externalAccountId,
        },
      },
      select: { id: true, status: true, metadata: true },
    });
    const data = {
      displayName: input.displayName ?? null,
      scopes: input.scopes,
      encryptedCredentials: encrypted,
      tokenExpiresAt: input.tokenExpiresAt ?? null,
      status: "active" as const,
      lastErrorAt: null,
      disconnectedAt: null,
      connectedById: actor.userId,
      metadata: accountMeta({ mock: input.mock, hint }, existing?.metadata as object | undefined),
    };
    const account = existing
      ? await tx.integrationAccount.update({
          where: { id: existing.id },
          data,
          select: { id: true },
        })
      : await tx.integrationAccount.create({
          data: {
            ...data,
            agencyId: ctx.agencyId,
            clientId: input.clientId,
            integrationId: integration.id,
            externalAccountId: input.externalAccountId,
          },
          select: { id: true },
        });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: input.clientId,
      action: existing ? "integration.reconnected" : "integration.connected",
      entityType: "integration_account",
      entityId: account.id,
      before: existing ? { status: existing.status } : null,
      after: { provider: integration.key, scopes: input.scopes, mock: input.mock },
    });
    return { id: account.id, reconnected: existing !== null };
  });
}

export async function disconnectAccount(actor: Actor, accountId: string, cipher: SecretCipher) {
  const { account, ctx } = await authorizeAccount(actor, accountId, "integration.manage");
  if (account.status === "disconnected") return;
  await prismaClient().$transaction(async (tx) => {
    // The stored credentials are destroyed, not just hidden: reconnecting needs new ones.
    await tx.integrationAccount.update({
      where: { id: accountId },
      data: {
        status: "disconnected",
        disconnectedAt: new Date(),
        encryptedCredentials: cipher.encrypt(
          "{}",
          credentialContext(account.clientId, account.integration.key),
        ),
        encryptedWebhookSecret: null,
        tokenExpiresAt: null,
        metadata: { ...(account.metadata as object), credentialHint: null },
      },
    });
    await tx.syncRun.updateMany({
      where: { integrationAccountId: accountId, status: "queued" },
      data: { status: "cancelled", finishedAt: new Date() },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: account.clientId,
      action: "integration.disconnected",
      entityType: "integration_account",
      entityId: accountId,
      before: { status: account.status },
      after: { status: "disconnected" },
    });
  });
}

// ---- Credentials (server only) ---------------------------------------------------------------------

/**
 * Run `fn` with the decrypted credentials of an account the actor may act on. The plaintext lives
 * only inside `fn`; callers must not return it.
 */
export async function withAccountCredentials<T>(
  actor: Actor,
  accountId: string,
  permission: "integration.sync" | "integration.manage",
  cipher: SecretCipher,
  fn: (
    credentials: Record<string, string>,
    account: { id: string; clientId: string; providerKey: string; isMock: boolean; status: string },
  ) => Promise<T>,
): Promise<T> {
  const { account } = await authorizeAccount(actor, accountId, permission);
  if (account.status === "disconnected")
    throw new ConflictError("This account is disconnected. Connect it again first");
  const row = await prismaClient().integrationAccount.findUniqueOrThrow({
    where: { id: accountId },
    select: { encryptedCredentials: true },
  });
  const credentials = JSON.parse(
    cipher.decrypt(
      row.encryptedCredentials,
      credentialContext(account.clientId, account.integration.key),
    ),
  ) as Record<string, string>;
  return fn(credentials, {
    id: account.id,
    clientId: account.clientId,
    providerKey: account.integration.key,
    isMock: (account.metadata as AccountMeta).mock === true,
    status: account.status,
  });
}

/** Record the outcome of a connection test. Safe text only. */
export async function recordConnectionTest(
  actor: Actor,
  accountId: string,
  result: { ok: true } | { ok: false; code: string; message: string; needsReconnect: boolean },
) {
  const { account, ctx } = await authorizeAccount(actor, accountId, "integration.sync");
  await prismaClient().$transaction(async (tx) => {
    const lastTest = result.ok
      ? { at: new Date().toISOString(), ok: true }
      : {
          at: new Date().toISOString(),
          ok: false,
          code: result.code,
          message: result.message.slice(0, 300),
        };
    const nextStatus = result.ok
      ? account.status === "needs_reauth" || account.status === "error"
        ? "active"
        : account.status
      : result.needsReconnect
        ? "needs_reauth"
        : account.status;
    await tx.integrationAccount.update({
      where: { id: accountId },
      data: {
        status: nextStatus,
        lastErrorAt: result.ok ? undefined : new Date(),
        metadata: { ...(account.metadata as object), lastTest },
      },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: account.clientId,
      action: "integration.tested",
      entityType: "integration_account",
      entityId: accountId,
      after: result.ok ? { ok: true } : { ok: false, code: result.code },
    });
  });
}

// ---- Sync requests ---------------------------------------------------------------------------------

async function createRun(
  tx: Tx,
  base: { agencyId: string; clientId: string; accountId: string },
  data: {
    kind: (typeof SYNC_KINDS)[number];
    trigger: "manual" | "retry" | "schedule";
    attempt: number;
  },
) {
  try {
    return await tx.syncRun.create({
      data: {
        agencyId: base.agencyId,
        clientId: base.clientId,
        integrationAccountId: base.accountId,
        status: "queued",
        ...data,
      },
      select: { id: true },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002")
      throw new ConflictError("A sync for this account is already queued or running");
    throw error;
  }
}

/** Queue a sync for the worker to execute. Nothing runs inside the web request. */
export async function queueSync(
  actor: Actor,
  accountId: string,
  kind: (typeof SYNC_KINDS)[number] = "manual",
) {
  if (!SYNC_KINDS.includes(kind)) throw new ValidationError({ kind: ["Unknown sync kind"] });
  const { account, ctx } = await authorizeAccount(actor, accountId, "integration.sync");
  if (account.status !== "active" && account.status !== "error")
    throw new ConflictError(
      account.status === "disconnected"
        ? "This account is disconnected"
        : "Fix the connection first: reconnect or test it",
    );
  return prismaClient().$transaction(async (tx) => {
    const run = await createRun(
      tx,
      { agencyId: ctx.agencyId, clientId: account.clientId, accountId },
      { kind, trigger: "manual", attempt: 1 },
    );
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: ctx.agencyId,
      clientId: account.clientId,
      action: "integration.sync_requested",
      entityType: "sync_run",
      entityId: run.id,
      after: { kind, accountId },
    });
    return run;
  });
}

/** Retry the account's latest failed, partial or cancelled run as a new attempt. */
export async function retrySync(actor: Actor, runId: string) {
  const source = await prismaClient().syncRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      clientId: true,
      agencyId: true,
      integrationAccountId: true,
      kind: true,
      status: true,
      attempt: true,
    },
  });
  if (!source) throw new NotFoundError("Sync run not found");
  await requirePermission(actor, source.clientId, "integration.sync");
  if (!["failed", "partial", "cancelled"].includes(source.status))
    throw new ConflictError("Only a failed, partial or cancelled sync can be retried");
  return prismaClient().$transaction(async (tx) => {
    const account = await tx.integrationAccount.findUniqueOrThrow({
      where: { id: source.integrationAccountId },
      select: { status: true },
    });
    if (account.status !== "active" && account.status !== "error")
      throw new ConflictError("Reconnect or test the account before retrying");
    const newer = await tx.syncRun.count({
      where: {
        integrationAccountId: source.integrationAccountId,
        createdAt: {
          gt: (
            await tx.syncRun.findUniqueOrThrow({
              where: { id: runId },
              select: { createdAt: true },
            })
          ).createdAt,
        },
      },
    });
    if (newer > 0) throw new ConflictError("A newer sync exists for this account; retry that one");
    const run = await createRun(
      tx,
      {
        agencyId: source.agencyId,
        clientId: source.clientId,
        accountId: source.integrationAccountId,
      },
      {
        kind: source.kind as (typeof SYNC_KINDS)[number],
        trigger: "retry",
        attempt: source.attempt + 1,
      },
    );
    await recordAudit(tx, {
      actorUserId: actor.userId,
      agencyId: source.agencyId,
      clientId: source.clientId,
      action: "integration.sync_retried",
      entityType: "sync_run",
      entityId: run.id,
      after: { retryOf: runId },
    });
    return run;
  });
}

// ---- Worker side (system, no actor) ----------------------------------------------------------------

export type SyncExecution = {
  runId: string;
  accountId: string;
  clientId: string;
  agencyId: string;
  providerKey: string;
  isMock: boolean;
  lastSyncedAt: Date | null;
  /** Scopes the provider granted when the account was connected. */
  scopes: string[];
  credentials: Record<string, string>;
};

/** Atomically take the oldest queued run (safe with several workers). */
export async function claimNextQueuedRun(): Promise<string | null> {
  const rows = await prismaClient().$queryRaw<{ id: string }[]>`
    UPDATE sync_runs SET status = 'running', started_at = now(), updated_at = now()
    WHERE id = (
      SELECT id FROM sync_runs WHERE status = 'queued'
      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  return rows[0]?.id ?? null;
}

export async function loadRunForExecution(
  runId: string,
  cipher: SecretCipher,
): Promise<SyncExecution> {
  const run = await prismaClient().syncRun.findUniqueOrThrow({
    where: { id: runId },
    select: {
      id: true,
      clientId: true,
      agencyId: true,
      integrationAccount: {
        select: {
          id: true,
          status: true,
          metadata: true,
          lastSyncedAt: true,
          scopes: true,
          encryptedCredentials: true,
          integration: { select: { key: true } },
        },
      },
    },
  });
  const a = run.integrationAccount;
  if (a.status === "disconnected") throw new ConflictError("Account disconnected");
  const credentials = JSON.parse(
    cipher.decrypt(a.encryptedCredentials, credentialContext(run.clientId, a.integration.key)),
  ) as Record<string, string>;
  return {
    runId: run.id,
    accountId: a.id,
    clientId: run.clientId,
    agencyId: run.agencyId,
    providerKey: a.integration.key,
    isMock: (a.metadata as AccountMeta).mock === true,
    lastSyncedAt: a.lastSyncedAt,
    scopes: a.scopes,
    credentials,
  };
}

export type SyncResult = {
  status: "succeeded" | "partial" | "failed";
  rowsFetched: number;
  rowsWritten: number;
  errors: { code: string; message: string; retryable: boolean; resource?: string | null }[];
  needsReconnect: boolean;
  /** Source metadata and per-resource results, stored on the run. */
  summary?: Record<string, unknown>;
};

/** Close a run, store its safe errors, and update the account. Idempotent for already-finished runs. */
export async function finishRun(runId: string, result: SyncResult): Promise<void> {
  await prismaClient().$transaction(async (tx) => {
    const run = await tx.syncRun.findUniqueOrThrow({
      where: { id: runId },
      select: {
        id: true,
        status: true,
        agencyId: true,
        clientId: true,
        integrationAccountId: true,
        startedAt: true,
      },
    });
    if (run.status !== "running" && run.status !== "queued") return;
    // started_at comes from the database clock; never finish before it, whatever this host's clock says.
    const now = new Date(Math.max(Date.now(), run.startedAt?.getTime() ?? 0));
    await tx.syncRun.update({
      where: { id: runId },
      data: {
        status: result.status,
        summary: (result.summary ?? {}) as Prisma.InputJsonObject,
        rowsFetched: result.rowsFetched,
        rowsWritten: result.rowsWritten,
        finishedAt: now,
      },
    });
    if (result.errors.length > 0) {
      await tx.syncError.createMany({
        data: result.errors.map((e) => ({
          agencyId: run.agencyId,
          clientId: run.clientId,
          syncRunId: runId,
          code: e.code.slice(0, 64),
          message: e.message.slice(0, 500),
          retryable: e.retryable,
          details: e.resource ? { resource: e.resource } : undefined,
        })),
      });
    }
    const account = await tx.integrationAccount.findUniqueOrThrow({
      where: { id: run.integrationAccountId },
      select: { status: true },
    });
    const nextStatus = result.needsReconnect
      ? "needs_reauth"
      : result.status === "failed"
        ? "error"
        : account.status === "error"
          ? "active"
          : account.status;
    await tx.integrationAccount.update({
      where: { id: run.integrationAccountId },
      data: {
        status: account.status === "disconnected" ? "disconnected" : nextStatus,
        lastSyncedAt: result.status === "failed" ? undefined : now,
        lastErrorAt: result.status === "succeeded" ? undefined : now,
      },
    });
    if (nextStatus !== account.status && account.status !== "disconnected") {
      await recordAudit(tx, {
        actorUserId: null,
        agencyId: run.agencyId,
        clientId: run.clientId,
        action: "integration.status_changed",
        entityType: "integration_account",
        entityId: run.integrationAccountId,
        before: { status: account.status },
        after: { status: nextStatus },
      });
    }
  });
}

/** Runs stuck "running" (worker crashed) are failed so the account is not blocked forever. */
export async function failStaleRuns(olderThanMs: number, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - olderThanMs);
  const stale = await prismaClient().syncRun.findMany({
    where: { status: "running", startedAt: { lt: cutoff } },
    select: { id: true },
  });
  for (const run of stale) {
    await finishRun(run.id, {
      status: "failed",
      rowsFetched: 0,
      rowsWritten: 0,
      needsReconnect: false,
      errors: [
        { code: "timeout", message: "The sync stopped responding and was ended.", retryable: true },
      ],
    });
  }
  return stale.length;
}

export type DuePolicy = {
  intervalMinutes: Record<string, number>;
  maxAutoAttempts: number;
  retryBaseMinutes: number;
};

/**
 * Queue scheduled syncs for LIVE active accounts whose interval has elapsed, and automatic retries
 * for retryable failures with backoff. Mock accounts are only synced on request.
 */
export async function queueDueSyncs(
  policy: DuePolicy,
  now = new Date(),
): Promise<{ scheduled: number; retried: number }> {
  const prisma = prismaClient();
  const accounts = await prisma.integrationAccount.findMany({
    where: {
      status: { in: ["active", "error"] },
      client: { status: "active" },
      syncRuns: { none: { status: { in: [...ACTIVE_RUN] } } },
    },
    select: {
      id: true,
      agencyId: true,
      clientId: true,
      lastSyncedAt: true,
      metadata: true,
      integration: { select: { key: true } },
      syncRuns: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          status: true,
          attempt: true,
          kind: true,
          finishedAt: true,
          syncErrors: { select: { retryable: true } },
        },
      },
    },
  });
  let scheduled = 0;
  let retried = 0;
  for (const a of accounts) {
    if ((a.metadata as AccountMeta).mock === true) continue;
    const interval = policy.intervalMinutes[a.integration.key];
    if (!interval) continue;
    const last = a.syncRuns[0];
    const base = { agencyId: a.agencyId, clientId: a.clientId, accountId: a.id };
    const retryable =
      last &&
      last.status === "failed" &&
      last.syncErrors.length > 0 &&
      last.syncErrors.every((e) => e.retryable);
    try {
      if (retryable && last.attempt < policy.maxAutoAttempts) {
        const waitMs = policy.retryBaseMinutes * 60_000 * 2 ** (last.attempt - 1);
        if (last.finishedAt && now.getTime() - last.finishedAt.getTime() >= waitMs) {
          await prisma.$transaction((tx) =>
            createRun(tx, base, {
              kind: last.kind as (typeof SYNC_KINDS)[number],
              trigger: "retry",
              attempt: last.attempt + 1,
            }),
          );
          retried++;
        }
        continue;
      }
      const due = !a.lastSyncedAt || now.getTime() - a.lastSyncedAt.getTime() >= interval * 60_000;
      if (due && !(last && last.status === "failed" && retryable)) {
        await prisma.$transaction((tx) =>
          createRun(tx, base, { kind: "incremental", trigger: "schedule", attempt: 1 }),
        );
        scheduled++;
      }
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error; // someone queued one first: fine
    }
  }
  return { scheduled, retried };
}

/**
 * Store refreshed provider credentials (an OAuth refresh). System use: the caller has already been
 * authorised to act on this account (a sync run, or a connection test the actor was allowed to start).
 * Providers that rotate refresh tokens invalidate the old one, so this must succeed before the new
 * token is used for anything else.
 */
export async function updateAccountCredentials(
  accountId: string,
  credentials: Record<string, string>,
  cipher: SecretCipher,
  options: { tokenExpiresAt?: Date | null } = {},
): Promise<void> {
  const account = await loadAccountScope(accountId);
  if (account.status === "disconnected") throw new ConflictError("Account disconnected");
  await prismaClient().$transaction(async (tx) => {
    await tx.integrationAccount.update({
      where: { id: accountId },
      data: {
        encryptedCredentials: cipher.encrypt(
          JSON.stringify(credentials),
          credentialContext(account.clientId, account.integration.key),
        ),
        tokenExpiresAt: options.tokenExpiresAt ?? null,
        metadata: {
          ...(account.metadata as object),
          credentialsUpdatedAt: new Date().toISOString(),
        },
      },
    });
    await recordAudit(tx, {
      actorUserId: null,
      agencyId: account.agencyId,
      clientId: account.clientId,
      action: "integration.credentials_refreshed",
      entityType: "integration_account",
      entityId: accountId,
    });
  });
}
