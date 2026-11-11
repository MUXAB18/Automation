import { beforeEach, describe, expect, it } from "vitest";
import { createTokenCipherForTests } from "../../test/cipher";
import { addMember, makeAgency, makeClient, makeUser, prisma, resetDb } from "../../test/helpers";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { connectAccount } from "./integrations";
import { persistProviderRecords } from "./provider-data";
import {
  cancelPublish,
  claimNextPublishingJob,
  finishPublishingJob,
  listPublishable,
  loadPublishExecution,
  markPublishRequestSent,
  reapStalePublishingJobs,
  requestPublish,
  resolvePublishReview,
  retryPublish,
} from "./publishing";

beforeEach(resetDb);
const cipher = createTokenCipherForTests();

async function world(mock = false) {
  const agency = await makeAgency("Agency");
  const other = await makeAgency("Other");
  const a = await makeClient("A", "a", agency.id);
  const b = await makeClient("B", "b", other.id);
  await prisma().integration.create({
    data: { key: "gohighlevel", name: "GoHighLevel", category: "crm", authType: "oauth2" },
  });
  const social = await makeUser();
  await addMember(social, a.id, "social_media_manager");
  const specialist = await makeUser();
  await addMember(specialist, a.id, "seo_specialist");
  const outsider = await makeUser();
  await addMember(outsider, b.id, "social_media_manager");
  const account = await connectAccount(
    social,
    {
      clientId: a.id,
      integrationKey: "gohighlevel",
      externalAccountId: "loc1",
      credentials: { accessToken: "tok-secret" },
      scopes: ["socialplanner/post.write"],
      mock,
    },
    cipher,
  );
  const t = { agencyId: a.agencyId, clientId: a.id, accountId: account.id, syncRunId: "r" };
  await persistProviderRecords(t, "social_accounts", [
    {
      resource: "social_accounts",
      externalId: "fb1",
      data: { platform: "facebook", name: "Page", isExpired: false },
    },
    {
      resource: "social_accounts",
      externalId: "old1",
      data: { platform: "x", name: "Old", isExpired: true },
    },
  ]);
  const base = { agencyId: a.agencyId, clientId: a.id };
  const item = await prisma().contentItem.create({
    data: {
      ...base,
      title: "Launch post",
      type: "social_post",
      channel: "facebook",
      status: "approved",
    },
  });
  const version = await prisma().contentVersion.create({
    data: { ...base, contentItemId: item.id, versionNo: 1, body: "Hello world" },
  });
  await prisma().contentItem.update({
    where: { id: item.id },
    data: { currentVersionId: version.id },
  });
  const approve = (versionId: string) =>
    prisma().contentApproval.create({
      data: {
        ...base,
        contentItemId: item.id,
        contentVersionId: versionId,
        status: "approved",
        decidedById: social.userId,
        decidedAt: new Date(),
      },
    });
  return { a, b, social, specialist, outsider, account, item, version, base, approve };
}

const req = (w: Awaited<ReturnType<typeof world>>, over = {}) => ({
  integrationAccountId: w.account.id,
  contentItemId: w.item.id,
  targetAccountIds: ["fb1"],
  ...over,
});

describe("requesting a publish", () => {
  it("requires an approval of exactly the current version", async () => {
    const w = await world();
    await expect(requestPublish(w.social, req(w))).rejects.toThrow(/not been approved/);
    await w.approve(w.version.id);
    // A newer version invalidates the old approval.
    const v2 = await prisma().contentVersion.create({
      data: { ...w.base, contentItemId: w.item.id, versionNo: 2, body: "Edited after approval" },
    });
    await prisma().contentItem.update({
      where: { id: w.item.id },
      data: { currentVersionId: v2.id },
    });
    await expect(requestPublish(w.social, req(w))).rejects.toBeInstanceOf(ConflictError);
    await w.approve(v2.id);
    const job = await requestPublish(w.social, req(w));
    expect(await prisma().publishingJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject(
      { status: "queued", contentVersionId: v2.id, targetAccountIds: ["fb1"] },
    );
    expect(
      (await prisma().contentItem.findUniqueOrThrow({ where: { id: w.item.id } })).status,
    ).toBe("scheduled");
  });

  it("is limited to people who can publish, and invisible to other tenants", async () => {
    const w = await world();
    await w.approve(w.version.id);
    await expect(requestPublish(w.specialist, req(w))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requestPublish(w.outsider, req(w))).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma().publishingJob.count()).toBe(0);
  });

  it("refuses a development mock account", async () => {
    const mock = await world(true);
    await mock.approve(mock.version.id);
    await expect(requestPublish(mock.social, req(mock))).rejects.toThrow(/mock/);
  });

  it("refuses unknown, expired or missing destinations", async () => {
    const w = await world();
    await w.approve(w.version.id);
    await expect(
      requestPublish(w.social, req(w, { targetAccountIds: ["nope"] })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      requestPublish(w.social, req(w, { targetAccountIds: ["old1"] })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(requestPublish(w.social, req(w, { targetAccountIds: [] }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await prisma().publishingJob.count()).toBe(0);
  });

  it("allows one job per version and account: a second request cannot post it again", async () => {
    const w = await world();
    await w.approve(w.version.id);
    await requestPublish(w.social, req(w));
    await expect(requestPublish(w.social, req(w))).rejects.toThrow(/already queued or published/);
    expect(await prisma().publishingJob.count()).toBe(1);
    expect(await listPublishable(w.social, w.account.id)).toEqual([]);
  });

  it("lists only approved, not-yet-queued content as publishable", async () => {
    const w = await world();
    expect(await listPublishable(w.social, w.account.id)).toEqual([]);
    await w.approve(w.version.id);
    expect(await listPublishable(w.social, w.account.id)).toEqual([
      expect.objectContaining({ id: w.item.id }),
    ]);
  });
});

async function queued(w: Awaited<ReturnType<typeof world>>) {
  await w.approve(w.version.id);
  const job = await requestPublish(w.social, req(w));
  const id = await claimNextPublishingJob();
  expect(id).toBe(job.id);
  return job.id;
}

describe("executing a job", () => {
  it("publishes once and records the provider post, and finishing twice changes nothing", async () => {
    const w = await world();
    const id = await queued(w);
    const exec = await loadPublishExecution(id, cipher);
    expect(exec).toMatchObject({ text: "Hello world", targetAccountIds: ["fb1"], attempts: 1 });
    expect(exec.credentials.accessToken).toBe("tok-secret");
    await markPublishRequestSent(id);
    await finishPublishingJob(id, {
      kind: "accepted",
      externalPostId: "ghl-post-1",
      providerStatus: "published",
    });
    await finishPublishingJob(id, {
      kind: "accepted",
      externalPostId: "ghl-post-2",
      providerStatus: "published",
    });
    expect(await prisma().publishedPost.findMany()).toEqual([
      expect.objectContaining({ externalPostId: "ghl-post-1", clientId: w.a.id }),
    ]);
    expect((await prisma().publishingJob.findUniqueOrThrow({ where: { id } })).status).toBe(
      "succeeded",
    );
    const item = await prisma().contentItem.findUniqueOrThrow({ where: { id: w.item.id } });
    expect(item.status).toBe("published");
    expect(item.publishedAt).not.toBeNull();
    expect(await claimNextPublishingJob()).toBeNull();
  });

  it("holds an unclear outcome for review and never retries it automatically", async () => {
    const w = await world();
    const id = await queued(w);
    await markPublishRequestSent(id);
    await finishPublishingJob(id, {
      kind: "unknown",
      message: "The provider took too long to answer.",
    });
    expect((await prisma().publishingJob.findUniqueOrThrow({ where: { id } })).status).toBe(
      "needs_review",
    );
    expect(await claimNextPublishingJob()).toBeNull();
    await expect(retryPublish(w.social, id)).rejects.toThrow(/resolve the review/);
    expect(await prisma().publishedPost.count()).toBe(0);
  });

  it("a person resolving 'not posted' makes a retry possible; resolving 'posted' records the post", async () => {
    const w = await world();
    const id = await queued(w);
    await markPublishRequestSent(id);
    await finishPublishingJob(id, { kind: "unknown", message: "timeout" });
    await resolvePublishReview(w.social, id, { outcome: "not_posted" });
    await retryPublish(w.social, id);
    expect(await claimNextPublishingJob()).toBe(id);
    await markPublishRequestSent(id);
    await finishPublishingJob(id, { kind: "unknown", message: "timeout again" });
    await resolvePublishReview(w.social, id, { outcome: "posted", externalPostId: "found-in-ghl" });
    expect(await prisma().publishedPost.findMany()).toEqual([
      expect.objectContaining({ externalPostId: "found-in-ghl" }),
    ]);
    await expect(
      resolvePublishReview(w.social, id, { outcome: "not_posted" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      resolvePublishReview(w.specialist, id, { outcome: "not_posted" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("re-queues a rate-limited job for later and fails a refused one so it can be retried", async () => {
    const w = await world();
    const id = await queued(w);
    await markPublishRequestSent(id);
    await finishPublishingJob(id, {
      kind: "rejected",
      message: "rate limited",
      retryAfterMs: 60_000,
    });
    const waiting = await prisma().publishingJob.findUniqueOrThrow({ where: { id } });
    expect(waiting).toMatchObject({ status: "scheduled", requestSentAt: null });
    expect(waiting.scheduledFor!.getTime()).toBeGreaterThan(Date.now() + 30_000);
    expect(await claimNextPublishingJob()).toBeNull();
    await prisma().publishingJob.update({
      where: { id },
      data: { scheduledFor: new Date(Date.now() - 1000) },
    });
    expect(await claimNextPublishingJob()).toBe(id);
    await markPublishRequestSent(id);
    await finishPublishingJob(id, { kind: "rejected", message: "Provider rejected the request." });
    expect((await prisma().publishingJob.findUniqueOrThrow({ where: { id } })).status).toBe(
      "failed",
    );
    await retryPublish(w.social, id);
    expect((await prisma().publishingJob.findUniqueOrThrow({ where: { id } })).status).toBe(
      "queued",
    );
  });

  it("does not call a post published when the provider reports another status", async () => {
    const w = await world();
    const id = await queued(w);
    await markPublishRequestSent(id);
    await finishPublishingJob(id, {
      kind: "accepted",
      externalPostId: "p1",
      providerStatus: "draft",
    });
    expect((await prisma().publishingJob.findUniqueOrThrow({ where: { id } })).status).toBe(
      "needs_review",
    );
    expect(await prisma().publishedPost.count()).toBe(0);
  });

  it("fails queued jobs whose approval was withdrawn instead of posting them", async () => {
    const w = await world();
    await w.approve(w.version.id);
    const job = await requestPublish(w.social, req(w));
    await prisma()
      .contentApproval.updateMany({
        data: { status: "cancelled", decidedAt: null, decidedById: null },
      })
      .catch(async () => {
        await prisma().contentApproval.updateMany({
          data: { status: "pending", decidedAt: null, decidedById: null },
        });
      });
    expect(await claimNextPublishingJob()).toBeNull();
    expect(await prisma().publishingJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject(
      { status: "failed" },
    );
  });

  it("recovers jobs left publishing by a crashed worker", async () => {
    const w = await world();
    const safe = await queued(w);
    await prisma().publishingJob.update({
      where: { id: safe },
      data: { startedAt: new Date(Date.now() - 3_600_000) },
    });
    expect(await reapStalePublishingJobs()).toBe(1);
    expect((await prisma().publishingJob.findUniqueOrThrow({ where: { id: safe } })).status).toBe(
      "queued",
    );
    await claimNextPublishingJob();
    await markPublishRequestSent(safe);
    await prisma().publishingJob.update({
      where: { id: safe },
      data: { startedAt: new Date(Date.now() - 3_600_000) },
    });
    await reapStalePublishingJobs();
    expect((await prisma().publishingJob.findUniqueOrThrow({ where: { id: safe } })).status).toBe(
      "needs_review",
    );
  });

  it("cancels a job that has not started", async () => {
    const w = await world();
    await w.approve(w.version.id);
    const job = await requestPublish(w.social, req(w));
    await cancelPublish(w.social, job.id);
    expect((await prisma().publishingJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      "cancelled",
    );
    expect(
      (await prisma().contentItem.findUniqueOrThrow({ where: { id: w.item.id } })).status,
    ).toBe("approved");
    await expect(cancelPublish(w.social, job.id)).rejects.toBeInstanceOf(ConflictError);
  });
});
