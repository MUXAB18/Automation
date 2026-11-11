import { beforeEach, describe, expect, it } from "vitest";
import { createTokenCipherForTests } from "../../test/cipher";
import { addMember, makeAgency, makeClient, makeUser, prisma, resetDb } from "../../test/helpers";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { LocalTimeError, utcToZonedLocal, zonedDay, zonedLocalToUtc } from "../time-zone";
import { createContentItem, listContentVersions, saveContentVersion } from "./content";
import {
  advanceContent,
  attachMedia,
  canMove,
  decideReview,
  getContentCalendar,
  getContentDetail,
  markPublishedManually,
  preflightPublish,
  scheduleContent,
  submitForReview,
  unscheduleContent,
  addContentComment,
  setClientApprovalRequired,
} from "./content-workflow";
import { validateContent } from "./content-validation";
import { connectAccount } from "./integrations";
import { persistProviderRecords } from "./provider-data";
import {
  claimNextPublishingJob,
  finishPublishingJob,
  markPublishRequestSent,
  requestPublish,
} from "./publishing";

beforeEach(resetDb);
const cipher = createTokenCipherForTests();
const HOUR = 3_600_000;

async function world(
  opts: { clientApproval?: boolean; channel?: "facebook" | "x" | "instagram" | "website" } = {},
) {
  const agency = await makeAgency("Agency");
  const client = await makeClient("Client", "client", agency.id);
  await prisma().client.update({ where: { id: client.id }, data: { timezone: "America/Toronto" } });
  await prisma().integration.create({
    data: { key: "gohighlevel", name: "GoHighLevel", category: "crm", authType: "oauth2" },
  });
  const writer = await makeUser();
  await addMember(writer, client.id, "content_writer");
  const reviewer = await makeUser();
  await addMember(reviewer, client.id, "reviewer");
  const social = await makeUser();
  await addMember(social, client.id, "social_media_manager");
  const clientUser = await makeUser();
  await addMember(clientUser, client.id, "client");
  const account = await connectAccount(
    social,
    {
      clientId: client.id,
      integrationKey: "gohighlevel",
      externalAccountId: "loc1",
      credentials: { accessToken: "tok" },
      scopes: ["socialplanner/post.write"],
      mock: false,
    },
    cipher,
  );
  await persistProviderRecords(
    { agencyId: agency.id, clientId: client.id, accountId: account.id, syncRunId: "r" },
    "social_accounts",
    [
      {
        resource: "social_accounts",
        externalId: "fb1",
        data: { platform: "facebook", name: "Page", isExpired: false },
      },
      {
        resource: "social_accounts",
        externalId: "ig1",
        data: { platform: "instagram", name: "IG", isExpired: false },
      },
    ],
  );
  const item = await createContentItem(writer, client.id, {
    title: "Spring sale",
    channel: opts.channel ?? "facebook",
    body: "Our spring sale starts Monday.",
    requiresClientApproval: opts.clientApproval ?? false,
  });
  return { agency, client, writer, reviewer, social, clientUser, account, itemId: item.id };
}
type W = Awaited<ReturnType<typeof world>>;

async function approveFully(w: W) {
  await submitForReview(w.writer, w.itemId);
  await decideReview(w.reviewer, w.itemId, { decision: "approve" });
  const s = (await prisma().contentItem.findUniqueOrThrow({ where: { id: w.itemId } })).status;
  if (s === "client_approval") await decideReview(w.clientUser, w.itemId, { decision: "approve" });
}
const future = (days = 3) =>
  utcToZonedLocal(new Date(Date.now() + days * 24 * HOUR), "America/Toronto").slice(0, 13) + ":30";

describe("time zones", () => {
  it("converts client wall time to the right UTC instant on both sides of daylight saving", () => {
    expect(zonedLocalToUtc("2026-07-01T09:00", "America/Toronto").toISOString()).toBe(
      "2026-07-01T13:00:00.000Z",
    ); // EDT, UTC-4
    expect(zonedLocalToUtc("2026-12-01T09:00", "America/Toronto").toISOString()).toBe(
      "2026-12-01T14:00:00.000Z",
    ); // EST, UTC-5
    expect(zonedLocalToUtc("2026-07-01T09:00", "Asia/Kolkata").toISOString()).toBe(
      "2026-07-01T03:30:00.000Z",
    );
  });
  it("refuses a time that does not exist and takes the first of a time that happens twice", () => {
    expect(() => zonedLocalToUtc("2026-03-08T02:30", "America/Toronto")).toThrow(LocalTimeError); // clocks skip 02:00 -> 03:00
    expect(zonedLocalToUtc("2026-11-01T01:30", "America/Toronto").toISOString()).toBe(
      "2026-11-01T05:30:00.000Z",
    ); // first 01:30 (EDT)
  });
  it("round-trips and places a late-evening post on the client's calendar day", () => {
    const at = zonedLocalToUtc("2026-10-10T23:30", "America/Vancouver");
    expect(at.toISOString()).toBe("2026-10-11T06:30:00.000Z");
    expect(zonedDay(at, "America/Vancouver")).toBe("2026-10-10");
    expect(utcToZonedLocal(at, "America/Vancouver")).toBe("2026-10-10T23:30");
  });
  it("rejects malformed input", () => {
    expect(() => zonedLocalToUtc("tomorrow", "UTC")).toThrow(LocalTimeError);
    expect(() => zonedLocalToUtc("2026-01-01T10:00", "Mars/Base")).toThrow(LocalTimeError);
  });
});

describe("channel validation", () => {
  const img = { fileName: "a.png", mimeType: "image/png", sizeBytes: 1000, altText: "alt" };
  it("enforces length, media and hashtag rules per channel", () => {
    expect(
      validateContent("x", { body: "a".repeat(281), hashtags: [], media: [] }).errors[0],
    ).toMatch(/280/);
    expect(
      validateContent("instagram", { body: "hi", hashtags: [], media: [] }).errors.join(),
    ).toMatch(/at least one image/);
    expect(validateContent("instagram", { body: "hi", hashtags: [], media: [img] }).errors).toEqual(
      [],
    );
    expect(
      validateContent("x", {
        body: "hi",
        hashtags: [],
        media: [img, { ...img, mimeType: "video/mp4" }],
      }).errors.join(),
    ).toMatch(/not both/);
    expect(
      validateContent("linkedin", {
        body: "hi",
        hashtags: [],
        media: [{ ...img, mimeType: "application/pdf" }],
      }).errors.join(),
    ).toMatch(/not a supported/);
    expect(
      validateContent("facebook", {
        body: "Buy now, miracle cure",
        hashtags: [],
        media: [],
        bannedTerms: ["miracle"],
      }).errors.join(),
    ).toMatch(/bans/);
    expect(
      validateContent("facebook", {
        body: "ok",
        hashtags: [],
        media: [{ ...img, altText: null }],
      }).warnings.join(),
    ).toMatch(/alt text/);
  });
});

describe("lifecycle and review", () => {
  it("only allows the documented transitions", () => {
    expect(canMove("draft", "in_review")).toBe(true);
    expect(canMove("draft", "published")).toBe(false);
    expect(canMove("rejected", "scheduled")).toBe(false);
    expect(canMove("published", "draft")).toBe(false);
    expect(canMove("cancelled", "draft")).toBe(true);
  });

  it("walks idea -> brief -> draft -> review -> approved and keeps a history", async () => {
    const w = await world();
    const idea = await createContentItem(w.writer, w.client.id, {
      title: "Idea",
      channel: "linkedin",
      status: "idea",
    });
    await advanceContent(w.writer, idea.id, "brief");
    await advanceContent(w.writer, idea.id, "draft");
    await expect(submitForReview(w.writer, idea.id)).rejects.toThrow(/Write the text/);
    await saveContentVersion(w.writer, idea.id, { body: "Now there is text." });
    await submitForReview(w.writer, idea.id);
    await decideReview(w.reviewer, idea.id, { decision: "approve" });
    const detail = await getContentDetail(w.social, idea.id);
    expect(detail.item.status).toBe("approved");
    expect(detail.events.map((e) => e.toStatus).reverse()).toEqual([
      "idea",
      "brief",
      "draft",
      "in_review",
      "approved",
    ]);
  });

  it("does not let authors approve their own version, or skip review", async () => {
    const w = await world();
    await expect(
      decideReview(w.reviewer, w.itemId, { decision: "approve" }),
    ).rejects.toBeInstanceOf(ConflictError); // not in review
    await submitForReview(w.writer, w.itemId);
    await expect(decideReview(w.writer, w.itemId, { decision: "approve" })).rejects.toBeInstanceOf(
      ForbiddenError,
    ); // no content.approve
    const selfReviewer = await makeUser();
    await addMember(selfReviewer, w.client.id, ["reviewer", "content_writer"]);
    await saveContentVersion(selfReviewer, w.itemId, { body: "Rewritten by a reviewer." }); // back to draft
    await submitForReview(selfReviewer, w.itemId);
    await expect(decideReview(selfReviewer, w.itemId, { decision: "approve" })).rejects.toThrow(
      /someone else/,
    );
  });

  it("requires a reason for changes or rejection, records comments, and sends it back", async () => {
    const w = await world();
    await submitForReview(w.writer, w.itemId);
    await expect(
      decideReview(w.reviewer, w.itemId, { decision: "request_changes" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await decideReview(w.reviewer, w.itemId, {
      decision: "request_changes",
      note: "Remove the discount claim",
    });
    const d = await getContentDetail(w.writer, w.itemId);
    expect(d.item.status).toBe("changes_requested");
    expect(d.comments.some((c) => c.isChangeRequest && c.body.includes("discount"))).toBe(true);
    expect(
      await prisma().notification.count({
        where: { userId: w.writer.userId, type: "content.changes_requested" },
      }),
    ).toBe(1);
    await addContentComment(w.clientUser, w.itemId, "Looks fine otherwise");
    await saveContentVersion(w.writer, w.itemId, {
      body: "Our spring sale starts Monday. Details in store.",
    });
    await submitForReview(w.writer, w.itemId);
    await decideReview(w.reviewer, w.itemId, { decision: "reject", note: "Off brand" });
    expect((await getContentDetail(w.writer, w.itemId)).item.status).toBe("rejected");
  });

  it("editing approved text invalidates the approval", async () => {
    const w = await world();
    await approveFully(w);
    await saveContentVersion(w.writer, w.itemId, { body: "Changed after approval." });
    expect((await getContentDetail(w.writer, w.itemId)).item.status).toBe("draft");
    await expect(scheduleContent(w.social, w.itemId, { scheduledLocal: future() })).rejects.toThrow(
      /Only approved/,
    );
    expect((await listContentVersions(w.writer, w.itemId)).map((v) => v.versionNo)).toEqual([2, 1]);
  });

  it("enforces optional client approval after internal review", async () => {
    const w = await world({ clientApproval: true });
    await submitForReview(w.writer, w.itemId);
    await expect(decideReview(w.clientUser, w.itemId, { decision: "approve" })).rejects.toThrow(
      /after the internal review/,
    );
    await decideReview(w.reviewer, w.itemId, { decision: "approve" });
    expect((await getContentDetail(w.writer, w.itemId)).item.status).toBe("client_approval");
    expect(
      await prisma().notification.count({
        where: { userId: w.clientUser.userId, type: "content.client_approval_requested" },
      }),
    ).toBe(1);
    await expect(decideReview(w.reviewer, w.itemId, { decision: "approve" })).rejects.toThrow(
      /Only the client/,
    );
    // Scheduling stays blocked until the client approves.
    await expect(
      requestPublish(w.social, {
        integrationAccountId: w.account.id,
        contentItemId: w.itemId,
        targetAccountIds: ["fb1"],
      }),
    ).rejects.toThrow();
    await decideReview(w.clientUser, w.itemId, { decision: "approve" });
    expect((await getContentDetail(w.writer, w.itemId)).item.status).toBe("approved");
    await expect(setClientApprovalRequired(w.writer, w.itemId, false)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe("scheduling", () => {
  it("schedules in the client's time zone and stores the UTC instant", async () => {
    const w = await world();
    await approveFully(w);
    const local = future();
    const r = await scheduleContent(w.social, w.itemId, {
      scheduledLocal: local,
      integrationAccountId: w.account.id,
      targetAccountIds: ["fb1"],
    });
    expect(r.mode).toBe("direct");
    const item = await prisma().contentItem.findUniqueOrThrow({ where: { id: w.itemId } });
    expect(item).toMatchObject({ status: "scheduled", scheduledTimezone: "America/Toronto" });
    expect(item.scheduledFor!.toISOString()).toBe(
      zonedLocalToUtc(local, "America/Toronto").toISOString(),
    );
    const job = await prisma().publishingJob.findFirstOrThrow({
      where: { contentItemId: w.itemId },
    });
    expect(job.status).toBe("scheduled");
    expect(job.scheduledFor!.toISOString()).toBe(item.scheduledFor!.toISOString());
  });

  it("rejects the past, a skipped clock time, and unapproved content", async () => {
    const w = await world();
    await expect(scheduleContent(w.social, w.itemId, { scheduledLocal: future() })).rejects.toThrow(
      /Only approved/,
    );
    await approveFully(w);
    await expect(
      scheduleContent(w.social, w.itemId, { scheduledLocal: "2020-01-01T10:00" }),
    ).rejects.toMatchObject({ fieldErrors: { scheduledLocal: ["Choose a time in the future"] } });
    await expect(
      scheduleContent(w.social, w.itemId, { scheduledLocal: "2030-03-10T02:30" }),
    ).rejects.toMatchObject({
      fieldErrors: { scheduledLocal: [expect.stringMatching(/does not exist/)] },
    });
  });

  it("only people with publish permission can schedule", async () => {
    const w = await world();
    await approveFully(w);
    await expect(
      scheduleContent(w.writer, w.itemId, { scheduledLocal: future() }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("checks that the account, the profile and the provider can really carry the post", async () => {
    const w = await world({ channel: "instagram" });
    const noMedia = await preflightPublish(w.social, w.itemId);
    expect(noMedia.errors.join()).toMatch(/at least one image/);
    await approveFully(w);
    await attachMedia(w.writer, w.itemId, {
      fileName: "a.png",
      mimeType: "image/png",
      sizeBytes: 5000,
      storageKey: "k1",
      sha256: "a".repeat(64),
      altText: "a",
    });
    const afterEdit = await preflightPublish(w.social, w.itemId);
    expect(afterEdit.mode).toBe("manual"); // text-only provider
    expect(afterEdit.directReasons.join()).toMatch(/text only/);
    await expect(
      scheduleContent(w.social, w.itemId, {
        scheduledLocal: future(),
        integrationAccountId: w.account.id,
        targetAccountIds: ["ig1"],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a profile of the wrong platform", async () => {
    const w = await world();
    await approveFully(w);
    await expect(
      scheduleContent(w.social, w.itemId, {
        scheduledLocal: future(),
        integrationAccountId: w.account.id,
        targetAccountIds: ["ig1"],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("can be unscheduled and scheduled again without a second job", async () => {
    const w = await world();
    await approveFully(w);
    const args = { integrationAccountId: w.account.id, targetAccountIds: ["fb1"] };
    await scheduleContent(w.social, w.itemId, { scheduledLocal: future(2), ...args });
    await unscheduleContent(w.social, w.itemId);
    expect((await getContentDetail(w.social, w.itemId)).item.status).toBe("approved");
    await scheduleContent(w.social, w.itemId, { scheduledLocal: future(4), ...args });
    expect(await prisma().publishingJob.count({ where: { contentItemId: w.itemId } })).toBe(1);
    expect((await prisma().publishingJob.findFirstOrThrow({})).status).toBe("scheduled");
  });

  it("does not create a second job for the same version and account", async () => {
    const w = await world();
    await approveFully(w);
    const args = { integrationAccountId: w.account.id, targetAccountIds: ["fb1"] };
    await scheduleContent(w.social, w.itemId, { scheduledLocal: future(), ...args });
    await expect(requestPublish(w.social, { ...args, contentItemId: w.itemId })).rejects.toThrow(
      /already queued/,
    );
  });
});

describe("publishing pipeline", () => {
  it("publishes through the worker path, records the post, history and notifies the people responsible", async () => {
    const w = await world();
    await approveFully(w);
    await scheduleContent(w.social, w.itemId, {
      scheduledLocal: future(),
      integrationAccountId: w.account.id,
      targetAccountIds: ["fb1"],
    });
    const job = await prisma().publishingJob.findFirstOrThrow({});
    await prisma().publishingJob.update({
      where: { id: job.id },
      data: { scheduledFor: new Date(Date.now() - 60_000) },
    }); // it is time
    const claimed = await claimNextPublishingJob();
    expect(claimed).toBe(job.id);
    await markPublishRequestSent(job.id);
    await finishPublishingJob(job.id, {
      kind: "accepted",
      externalPostId: "post-1",
      providerStatus: "published",
    });
    const d = await getContentDetail(w.social, w.itemId);
    expect(d.item.status).toBe("published");
    expect(d.jobs[0]).toMatchObject({ status: "succeeded" });
    expect(d.jobs[0]!.publishedPost?.externalPostId).toBe("post-1");
    expect(d.events.some((e) => e.toStatus === "published")).toBe(true);
    expect(
      await prisma().notification.count({
        where: { userId: w.writer.userId, type: "publishing.succeeded" },
      }),
    ).toBe(1);
    // A repeated answer from the provider does not create a second post or notification.
    await finishPublishingJob(job.id, {
      kind: "accepted",
      externalPostId: "post-1",
      providerStatus: "published",
    });
    expect(await prisma().publishedPost.count()).toBe(1);
    expect(
      await prisma().notification.count({
        where: { type: "publishing.succeeded", userId: w.writer.userId },
      }),
    ).toBe(1);
  });

  it("retries a rate limit later, flags a permanent failure and an unknown outcome for a person", async () => {
    const w = await world();
    await approveFully(w);
    await scheduleContent(w.social, w.itemId, {
      scheduledLocal: future(),
      integrationAccountId: w.account.id,
      targetAccountIds: ["fb1"],
    });
    const job = await prisma().publishingJob.findFirstOrThrow({});
    await prisma().publishingJob.update({
      where: { id: job.id },
      data: { scheduledFor: new Date(Date.now() - 60_000) },
    });
    await claimNextPublishingJob();
    await finishPublishingJob(job.id, { kind: "rejected", message: "rate", retryAfterMs: 60_000 });
    expect(await prisma().publishingJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject(
      { status: "scheduled" },
    );
    await prisma()
      .$executeRaw`UPDATE publishing_jobs SET scheduled_for = now() - interval '1 second' WHERE id = ${job.id}`;
    await claimNextPublishingJob();
    await finishPublishingJob(job.id, { kind: "unknown", message: "timeout" });
    expect(await prisma().publishingJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject(
      { status: "needs_review" },
    );
    expect(
      await prisma().notification.count({
        where: { userId: w.social.userId, type: "publishing.needs_review" },
      }),
    ).toBe(1);
  });

  it("marks content failed and tells people on a permanent refusal", async () => {
    const w = await world();
    await approveFully(w);
    await scheduleContent(w.social, w.itemId, {
      scheduledLocal: future(),
      integrationAccountId: w.account.id,
      targetAccountIds: ["fb1"],
    });
    const job = await prisma().publishingJob.findFirstOrThrow({});
    await prisma().publishingJob.update({
      where: { id: job.id },
      data: { scheduledFor: new Date(Date.now() - 60_000) },
    });
    await claimNextPublishingJob();
    await finishPublishingJob(job.id, {
      kind: "rejected",
      message: "The profile was disconnected",
    });
    expect((await getContentDetail(w.social, w.itemId)).item.status).toBe("failed");
    expect(
      await prisma().notification.count({
        where: { userId: w.social.userId, type: "publishing.failed" },
      }),
    ).toBe(1);
  });
});

describe("manual publishing fallback", () => {
  it("records a hand-published post once, with the same approval requirements", async () => {
    const w = await world({ channel: "website" });
    await expect(markPublishedManually(w.social, w.itemId)).rejects.toThrow(
      /approved or scheduled/,
    );
    await approveFully(w);
    const pre = await preflightPublish(w.social, w.itemId);
    expect(pre.mode).toBe("manual");
    await scheduleContent(w.social, w.itemId, { scheduledLocal: future() }); // manual schedule
    expect((await getContentDetail(w.social, w.itemId)).item.status).toBe("scheduled");
    await expect(
      markPublishedManually(w.social, w.itemId, { publishedUrl: "not a link" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await markPublishedManually(w.social, w.itemId, {
      publishedUrl: "https://example.com/post",
      note: "Posted by Sam",
    });
    const d = await getContentDetail(w.social, w.itemId);
    expect(d.item.status).toBe("published");
    expect(d.manual[0]).toMatchObject({ publishedUrl: "https://example.com/post" });
    await expect(markPublishedManually(w.social, w.itemId)).rejects.toThrow(
      /approved or scheduled/,
    );
  });

  it("does not allow it when a direct job could also post (no duplicate posts)", async () => {
    const w = await world();
    await approveFully(w);
    await scheduleContent(w.social, w.itemId, {
      scheduledLocal: future(),
      integrationAccountId: w.account.id,
      targetAccountIds: ["fb1"],
    });
    await expect(markPublishedManually(w.social, w.itemId)).rejects.toThrow(
      /direct publishing job/,
    );
  });

  it("cannot cancel content that is scheduled", async () => {
    const w = await world({ channel: "website" });
    await approveFully(w);
    await scheduleContent(w.social, w.itemId, { scheduledLocal: future() });
    await expect(advanceContent(w.writer, w.itemId, "cancelled")).rejects.toThrow(/Unschedule/);
  });
});

describe("calendar and isolation", () => {
  it("places items on the client's local day and lists unscheduled work", async () => {
    const w = await world();
    await approveFully(w);
    await prisma().contentItem.update({
      where: { id: w.itemId },
      data: { scheduledFor: zonedLocalToUtc("2026-10-10T23:30", "America/Toronto") },
    });
    await createContentItem(w.writer, w.client.id, { title: "No date yet", channel: "x" });
    const day = await getContentCalendar(w.social, { from: "2026-10-10", to: "2026-10-10" });
    expect(day.items.map((i) => i.localDay)).toEqual(["2026-10-10"]);
    expect(day.items[0]!.localTime).toBe("23:30");
    expect(
      (await getContentCalendar(w.social, { from: "2026-10-11", to: "2026-10-11" })).items,
    ).toHaveLength(0);
    expect(day.unscheduled.some((u) => u.title === "No date yet")).toBe(true);
    await expect(
      getContentCalendar(w.social, { from: "bad", to: "2026-10-11" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("another agency sees nothing and cannot act", async () => {
    const w = await world();
    await approveFully(w);
    const other = await makeAgency("Other");
    const oc = await makeClient("OC", "oc", other.id);
    const spy = await makeUser();
    await addMember(spy, oc.id, "agency_admin");
    expect(
      (await getContentCalendar(spy, { from: "2026-01-01", to: "2030-01-01" })).items,
    ).toHaveLength(0);
    await expect(getContentDetail(spy, w.itemId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(submitForReview(spy, w.itemId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(decideReview(spy, w.itemId, { decision: "approve" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      scheduleContent(spy, w.itemId, { scheduledLocal: future() }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(markPublishedManually(spy, w.itemId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("media of the wrong type or size is refused", async () => {
    const w = await world();
    await expect(
      attachMedia(w.writer, w.itemId, {
        fileName: "a.exe",
        mimeType: "application/x-msdownload",
        sizeBytes: 10,
        storageKey: "k",
        sha256: "a".repeat(64),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      attachMedia(w.writer, w.itemId, {
        fileName: "a.png",
        mimeType: "image/png",
        sizeBytes: 99_000_000,
        storageKey: "k2",
        sha256: "a".repeat(64),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
