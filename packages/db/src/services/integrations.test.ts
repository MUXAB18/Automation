import { beforeEach, describe, expect, it } from "vitest";
import { createTokenCipherForTests } from "../../test/cipher";
import { addMember, makeAgency, makeClient, makeUser, prisma, resetDb } from "../../test/helpers";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { deriveHealth, type HealthRun } from "./integration-health";
import {
  claimNextQueuedRun,
  connectAccount,
  disconnectAccount,
  failStaleRuns,
  finishRun,
  getAccountDetail,
  getClientIntegrations,
  loadRunForExecution,
  queueDueSyncs,
  queueSync,
  recordConnectionTest,
  retrySync,
  withAccountCredentials,
} from "./integrations";

beforeEach(resetDb);
const cipher = createTokenCipherForTests();
const SECRET = "sk-live-0123456789abcdef";

async function world() {
  const agency = await makeAgency("Agency");
  const other = await makeAgency("Other");
  const a = await makeClient("A", "a", agency.id);
  const b = await makeClient("B", "b", other.id);
  const a2 = await makeClient("A2", "a2", agency.id);
  await prisma().integration.createMany({
    data: [
      { key: "se_ranking", name: "SE Ranking", category: "seo_data", authType: "api_key" },
      { key: "google_search_console", name: "GSC", category: "search", authType: "oauth2" },
    ],
  });
  const manager = await makeUser();
  await addMember(manager, a.id, "seo_manager");
  const specialist = await makeUser();
  await addMember(specialist, a.id, "seo_specialist");
  const client = await makeUser();
  await addMember(client, a.id, "client");
  const outsider = await makeUser();
  await addMember(outsider, b.id, "seo_manager");
  return { agency, a, a2, b, manager, specialist, client, outsider };
}

const connect = (actor: Awaited<ReturnType<typeof makeUser>>, clientId: string, extra = {}) =>
  connectAccount(
    actor,
    {
      clientId,
      integrationKey: "se_ranking",
      externalAccountId: "ext-1",
      displayName: "Main",
      credentials: { apiKey: SECRET },
      hintField: "apiKey",
      scopes: [],
      ...extra,
    },
    cipher,
  );

describe("connecting", () => {
  it("stores only ciphertext and never exposes credentials in any view", async () => {
    const { manager, a } = await world();
    const { id } = await connect(manager, a.id);
    const row = await prisma().integrationAccount.findUniqueOrThrow({ where: { id } });
    expect(row.encryptedCredentials).not.toContain(SECRET);
    expect(row.encryptedCredentials.startsWith("v1.")).toBe(true);

    const list = await getClientIntegrations(manager, a.id);
    const detail = await getAccountDetail(manager, id);
    for (const out of [JSON.stringify(list), JSON.stringify(detail)]) {
      expect(out).not.toContain(SECRET);
      expect(out).not.toContain(row.encryptedCredentials);
    }
    expect(list.accounts[0]?.credentialHint).toBe("••••cdef");
  });

  it("audits without credentials", async () => {
    const { manager, a } = await world();
    await connect(manager, a.id);
    const logs = await prisma().auditLog.findMany({ where: { action: "integration.connected" } });
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain(SECRET);
  });

  it("reconnecting the same provider account replaces credentials and reactivates it", async () => {
    const { manager, a } = await world();
    const first = await connect(manager, a.id);
    await prisma().integrationAccount.update({
      where: { id: first.id },
      data: { status: "needs_reauth" },
    });
    const second = await connect(manager, a.id, {
      credentials: { apiKey: "another-key-9876543210" },
    });
    expect(second).toEqual({ id: first.id, reconnected: true });
    const row = await prisma().integrationAccount.findUniqueOrThrow({ where: { id: first.id } });
    expect(row.status).toBe("active");
    expect(await prisma().integrationAccount.count()).toBe(1);
    await withAccountCredentials(manager, first.id, "integration.sync", cipher, async (c) => {
      expect(c.apiKey).toBe("another-key-9876543210");
    });
  });

  it("needs integration.manage, and other clients/agencies cannot reach it", async () => {
    const { specialist, client, outsider, manager, a } = await world();
    await expect(connect(specialist, a.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(connect(client, a.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(connect(outsider, a.id)).rejects.toBeInstanceOf(NotFoundError);
    const { id } = await connect(manager, a.id);
    await expect(getAccountDetail(outsider, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(queueSync(outsider, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      withAccountCredentials(outsider, id, "integration.sync", cipher, async () => 1),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets a specialist see status but not change anything", async () => {
    const { specialist, manager, a } = await world();
    const { id } = await connect(manager, a.id);
    expect((await getClientIntegrations(specialist, a.id)).canManage).toBe(false);
    await expect(getAccountDetail(specialist, id)).resolves.toBeTruthy();
    await expect(queueSync(specialist, id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(disconnectAccount(specialist, id, cipher)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects ciphertext decrypted for another client (context binding)", async () => {
    const { manager, a, a2 } = await world();
    const { id } = await connect(manager, a.id);
    const row = await prisma().integrationAccount.findUniqueOrThrow({ where: { id } });
    expect(() => cipher.decrypt(row.encryptedCredentials, `${a2.id}:se_ranking`)).toThrow();
  });

  it("disconnect destroys credentials and cancels queued syncs", async () => {
    const { manager, a } = await world();
    const { id } = await connect(manager, a.id);
    await queueSync(manager, id);
    await disconnectAccount(manager, id, cipher);
    const row = await prisma().integrationAccount.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("disconnected");
    expect(cipher.decrypt(row.encryptedCredentials, `${a.id}:se_ranking`)).toBe("{}");
    expect((await prisma().syncRun.findFirstOrThrow()).status).toBe("cancelled");
    await expect(queueSync(manager, id)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("connection tests", () => {
  it("a rejected credential flips the account to needs_reauth; success restores it", async () => {
    const { manager, a } = await world();
    const { id } = await connect(manager, a.id);
    await recordConnectionTest(manager, id, {
      ok: false,
      code: "auth_failed",
      message: "rejected",
      needsReconnect: true,
    });
    let row = await prisma().integrationAccount.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("needs_reauth");
    expect(row.lastErrorAt).not.toBeNull();
    await expect(queueSync(manager, id)).rejects.toBeInstanceOf(ConflictError);
    await recordConnectionTest(manager, id, { ok: true });
    row = await prisma().integrationAccount.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("active");
    expect((await getAccountDetail(manager, id)).account.lastTest?.ok).toBe(true);
  });
});

describe("sync runs", () => {
  it("queues one at a time, and the database enforces it", async () => {
    const { manager, a } = await world();
    const { id } = await connect(manager, a.id);
    await queueSync(manager, id);
    await expect(queueSync(manager, id)).rejects.toBeInstanceOf(ConflictError);
    await expect(
      prisma().syncRun.create({
        data: { agencyId: a.agencyId, clientId: a.id, integrationAccountId: id, status: "running" },
      }),
    ).rejects.toThrow();
  });

  it("claims, executes with decrypted credentials, and records start/finish and safe errors", async () => {
    const { manager, a } = await world();
    const { id } = await connect(manager, a.id, { mock: true });
    const queued = await queueSync(manager, id);
    const claimed = await claimNextQueuedRun();
    expect(claimed).toBe(queued.id);
    expect(await claimNextQueuedRun()).toBeNull();
    const exec = await loadRunForExecution(queued.id, cipher);
    expect(exec).toMatchObject({ providerKey: "se_ranking", isMock: true, clientId: a.id });
    expect(exec.credentials.apiKey).toBe(SECRET);

    await finishRun(queued.id, {
      status: "partial",
      rowsFetched: 6,
      rowsWritten: 0,
      needsReconnect: false,
      errors: [
        {
          code: "provider_unavailable",
          message: "x".repeat(900),
          retryable: true,
          resource: "backlinks",
        },
      ],
    });
    const run = await prisma().syncRun.findUniqueOrThrow({
      where: { id: queued.id },
      include: { syncErrors: true },
    });
    expect(run).toMatchObject({ status: "partial", rowsFetched: 6 });
    expect(run.startedAt).not.toBeNull();
    expect(run.finishedAt).not.toBeNull();
    expect(run.syncErrors[0]?.message.length).toBeLessThanOrEqual(500);
    // finishing twice changes nothing
    await finishRun(queued.id, {
      status: "failed",
      rowsFetched: 0,
      rowsWritten: 0,
      needsReconnect: false,
      errors: [],
    });
    expect((await prisma().syncRun.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe(
      "partial",
    );
  });

  it("an auth failure marks the account for reconnection", async () => {
    const { manager, a } = await world();
    const { id } = await connect(manager, a.id);
    const run = await queueSync(manager, id);
    await claimNextQueuedRun();
    await finishRun(run.id, {
      status: "failed",
      rowsFetched: 0,
      rowsWritten: 0,
      needsReconnect: true,
      errors: [{ code: "auth_failed", message: "no", retryable: false }],
    });
    expect((await prisma().integrationAccount.findUniqueOrThrow({ where: { id } })).status).toBe(
      "needs_reauth",
    );
    expect(await prisma().auditLog.count({ where: { action: "integration.status_changed" } })).toBe(
      1,
    );
  });

  it("retries only the latest failed run, as a new attempt", async () => {
    const { manager, a } = await world();
    const { id } = await connect(manager, a.id);
    const first = await queueSync(manager, id);
    await expect(retrySync(manager, first.id)).rejects.toBeInstanceOf(ConflictError); // still queued
    await claimNextQueuedRun();
    await finishRun(first.id, {
      status: "failed",
      rowsFetched: 0,
      rowsWritten: 0,
      needsReconnect: false,
      errors: [{ code: "timeout", message: "t", retryable: true }],
    });
    const retry = await retrySync(manager, first.id);
    const row = await prisma().syncRun.findUniqueOrThrow({ where: { id: retry.id } });
    expect(row).toMatchObject({ attempt: 2, trigger: "retry", status: "queued" });
    await claimNextQueuedRun();
    await finishRun(retry.id, {
      status: "succeeded",
      rowsFetched: 1,
      rowsWritten: 0,
      needsReconnect: false,
      errors: [],
    });
    await expect(retrySync(manager, first.id)).rejects.toBeInstanceOf(ConflictError); // newer run exists
  });

  it("fails runs left running by a crashed worker", async () => {
    const { manager, a } = await world();
    const { id } = await connect(manager, a.id);
    const run = await queueSync(manager, id);
    await claimNextQueuedRun();
    expect(await failStaleRuns(60_000)).toBe(0);
    await prisma().syncRun.update({
      where: { id: run.id },
      data: { startedAt: new Date(Date.now() - 2 * 3_600_000) },
    });
    expect(await failStaleRuns(60 * 60_000)).toBe(1);
    expect((await prisma().syncRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe(
      "failed",
    );
  });

  it("history is paged and scoped to the account's client", async () => {
    const { manager, a, outsider } = await world();
    const { id } = await connect(manager, a.id);
    const run = await queueSync(manager, id);
    const detail = await getAccountDetail(manager, id);
    expect(detail.runs.rows[0]?.id).toBe(run.id);
    expect(detail.health.state).toBe("not_synced");
    await expect(getAccountDetail(outsider, id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("scheduler", () => {
  const policy = { intervalMinutes: { se_ranking: 60 }, maxAutoAttempts: 3, retryBaseMinutes: 5 };

  it("never schedules mock accounts, schedules due live ones once, and retries retryable failures with backoff", async () => {
    const { manager, a } = await world();
    const mock = await connect(manager, a.id, { mock: true });
    const live = await connect(manager, a.id, { externalAccountId: "live-1" });
    const first = await queueDueSyncs(policy);
    expect(first).toEqual({ scheduled: 1, retried: 0 });
    expect(await prisma().syncRun.count({ where: { integrationAccountId: mock.id } })).toBe(0);
    expect(await queueDueSyncs(policy)).toEqual({ scheduled: 0, retried: 0 }); // already queued

    const run = (
      await prisma().syncRun.findFirstOrThrow({ where: { integrationAccountId: live.id } })
    ).id;
    await claimNextQueuedRun();
    await finishRun(run, {
      status: "failed",
      rowsFetched: 0,
      rowsWritten: 0,
      needsReconnect: false,
      errors: [{ code: "rate_limited", message: "r", retryable: true }],
    });
    expect(await queueDueSyncs(policy)).toEqual({ scheduled: 0, retried: 0 }); // backoff not elapsed
    const finished = (await prisma().syncRun.findUniqueOrThrow({ where: { id: run } })).finishedAt!;
    const later = new Date(finished.getTime() + 6 * 60_000);
    expect(await queueDueSyncs(policy, later)).toEqual({ scheduled: 0, retried: 1 });
    expect(
      (
        await prisma().syncRun.findFirstOrThrow({
          where: { integrationAccountId: live.id, status: "queued" },
        })
      ).attempt,
    ).toBe(2);
  });
});

describe("provider health", () => {
  const now = new Date("2026-01-02T00:00:00Z");
  const run = (status: string, codes: string[] = [], mins = 0): HealthRun => ({
    status,
    errorCodes: codes,
    createdAt: new Date(now.getTime() - mins * 60_000),
    startedAt: new Date(now.getTime() - mins * 60_000 - 2000),
    finishedAt: new Date(now.getTime() - mins * 60_000),
  });
  it("derives state from recent runs", () => {
    const h = (s: string, runs: HealthRun[]) => deriveHealth({ status: s }, runs, now);
    expect(h("active", []).state).toBe("not_synced");
    expect(h("active", [run("succeeded"), run("failed")]).state).toBe("healthy");
    expect(h("active", [run("failed"), run("succeeded")]).state).toBe("degraded");
    expect(h("active", [run("partial")]).state).toBe("degraded");
    expect(h("active", [run("failed"), run("failed"), run("failed")]).state).toBe("failing");
    expect(h("needs_reauth", [run("succeeded")]).state).toBe("needs_reconnect");
    expect(h("disconnected", []).state).toBe("disconnected");
    expect(h("active", [run("queued"), run("running"), run("succeeded")]).state).toBe("healthy");
  });
  it("counts rate limit hits and average duration", () => {
    const out = deriveHealth(
      { status: "active" },
      [run("failed", ["rate_limited", "quota_exhausted"]), run("succeeded", [], 60 * 30)],
      now,
    );
    expect(out.rateLimitHits24h).toBe(2);
    expect(out.avgDurationMs).toBe(2000);
    expect(out.successRate).toBe(0.5);
  });
});
