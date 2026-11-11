import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import {
  addAgencyStaff,
  addMember,
  makeAgency,
  makeClient,
  makeUser,
  prisma,
  resetDb,
} from "../../test/helpers";
import {
  saveAiOutputAsDraft,
  listContentVersions,
  restoreContentVersion,
  saveContentVersion,
} from "../services/content";
import { createMockAiProvider } from "./mock-provider";
import { AiProviderError, type AiRuntimeConfig } from "./provider";
import {
  claimNextAiJob,
  executeAiJob,
  extractJson,
  reapStaleAiJobs,
  MAX_AI_ATTEMPTS,
} from "./runner";
import {
  addApprovedSource,
  getAiJob,
  listAiJobs,
  regenerate,
  requestGeneration,
  reviewAiJob,
  setAiLimit,
} from "./service";
import { outputSchemas } from "./templates";

beforeEach(resetDb);

const cfg: AiRuntimeConfig = {
  provider: "mock",
  model: "mock-1",
  defaultMonthlyRequests: 50,
  defaultMonthlyCostUsd: 0,
  perUserHourly: 30,
};
const topicInput = {
  topic: "Winter tyre storage",
  keywords: ["tyre storage"],
  primaryKeyword: "tyre storage",
};

async function world() {
  const agency = await makeAgency("Agency One");
  const client = await makeClient("Client One", "client-one", agency.id);
  const admin = await makeUser();
  await addAgencyStaff(admin, agency.id, "agency_admin", true);
  return { agency, client, admin };
}

async function run(jobId: string, provider = createMockAiProvider()) {
  const claimed = await claimNextAiJob();
  expect(claimed).toBe(jobId);
  await executeAiJob(jobId, provider, cfg);
  return prisma().aiJob.findUniqueOrThrow({ where: { id: jobId } });
}

describe("generation", () => {
  it("records provider, model, prompt version, input refs, tokens, cost and a validated, unverified output", async () => {
    const { client, admin } = await world();
    await addApprovedSource(admin, client.id, {
      title: "Services",
      body: "We store tyres in a heated warehouse.",
    });
    const { id } = await requestGeneration(
      admin,
      { clientId: client.id, task: "blog_draft", input: topicInput },
      cfg,
    );
    const job = await run(id);
    expect(job).toMatchObject({
      status: "succeeded",
      provider: "mock",
      model: "mock-1",
      promptVersion: "blog_draft@1",
      task: "blog_draft",
    });
    expect(job.inputTokens).toBeGreaterThan(0);
    expect(job.estimatedCostMicros).toBe(0n);
    const out = job.output as { result: unknown; unverified: boolean; disclaimer: string };
    expect(outputSchemas.blog_draft.safeParse(out.result).success).toBe(true);
    expect(out.unverified).toBe(true);
    expect((job.inputRefs as { sourceIds: string[] }).sourceIds).toHaveLength(1);
    expect(await prisma().aiUsageRecord.count({ where: { aiJobId: id } })).toBe(1);
    expect(await prisma().auditLog.count({ where: { entityId: id } })).toBeGreaterThanOrEqual(2);
  });

  it("supports every task type with mock output that passes validation", async () => {
    const { client, admin } = await world();
    const item = await prisma().contentItem.create({
      data: {
        agencyId: client.agencyId,
        clientId: client.id,
        title: "Src",
        type: "blog_post",
        channel: "website",
      },
    });
    const v = await prisma().contentVersion.create({
      data: {
        agencyId: client.agencyId,
        clientId: client.id,
        contentItemId: item.id,
        versionNo: 1,
        body: "Source text.",
      },
    });
    await prisma().contentItem.update({ where: { id: item.id }, data: { currentVersionId: v.id } });
    const inputs: Record<string, unknown> = {
      content_brief: topicInput,
      blog_draft: topicInput,
      seo_titles: topicInput,
      meta_descriptions: topicInput,
      social_captions: { topic: "Winter", channel: "x" },
      hashtags: { topic: "Winter", channel: "instagram" },
      repurpose: { sourceContentItemId: item.id, targetChannel: "linkedin" },
      seo_recommendations: { focus: "Product pages", includeOpenSeoIssues: true },
      report_summary: { periodStart: "2026-10-01", periodEnd: "2026-10-31" },
    };
    for (const [task, input] of Object.entries(inputs)) {
      const { id } = await requestGeneration(admin, { clientId: client.id, task, input }, cfg);
      const job = await run(id);
      expect(job.status, `${task}: ${job.error}`).toBe("succeeded");
    }
  });

  it("accepts JSON in a code fence and rejects output that does not match the schema", async () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => extractJson("no json here")).toThrow();
    const { client, admin } = await world();
    const { id } = await requestGeneration(
      admin,
      { clientId: client.id, task: "seo_titles", input: topicInput },
      cfg,
    );
    const job = await run(id, createMockAiProvider({ raw: () => '{"suggestions":[]}' }));
    // An unusable answer is retried; the job is queued again with the reason.
    expect(job.status).toBe("queued");
    expect(job.attempt).toBe(2);
    expect(job.error).toMatch(/expected format/);
    expect(job.output).toBeNull();
  });

  it("retries a transient provider failure later, then fails permanently after the attempt limit", async () => {
    const { client, admin } = await world();
    const { id } = await requestGeneration(
      admin,
      { clientId: client.id, task: "hashtags", input: { topic: "Winter" } },
      cfg,
    );
    const flaky = createMockAiProvider({
      failWith: () => new AiProviderError("The provider is busy.", true),
    });
    let job = await run(id, flaky);
    expect(job).toMatchObject({ status: "queued", attempt: 2 });
    expect(job.nextAttemptAt).not.toBeNull();
    expect(await claimNextAiJob()).toBeNull(); // not due yet
    for (let a = 2; a <= MAX_AI_ATTEMPTS; a++) {
      await prisma()
        .$executeRaw`UPDATE ai_jobs SET next_attempt_at = now() - interval '1 second' WHERE id = ${id}`;
      job = await run(id, flaky);
    }
    expect(job).toMatchObject({ status: "failed", error: "The provider is busy." });
  });

  it("does not retry a permanent provider failure", async () => {
    const { client, admin } = await world();
    const { id } = await requestGeneration(
      admin,
      { clientId: client.id, task: "hashtags", input: { topic: "Winter" } },
      cfg,
    );
    const job = await run(
      id,
      createMockAiProvider({ failWith: () => new AiProviderError("The key was rejected.", false) }),
    );
    expect(job).toMatchObject({ status: "failed", attempt: 1 });
  });

  it("re-queues a job whose worker disappeared", async () => {
    const { client, admin } = await world();
    const { id } = await requestGeneration(
      admin,
      { clientId: client.id, task: "hashtags", input: { topic: "Winter" } },
      cfg,
    );
    await claimNextAiJob();
    expect(await reapStaleAiJobs(new Date(Date.now() + 12 * 3_600_000))).toBe(1);
    expect(await prisma().aiJob.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "queued",
      attempt: 2,
    });
  });

  it("the same idempotency key returns the same job", async () => {
    const { client, admin } = await world();
    const req = {
      clientId: client.id,
      task: "hashtags",
      input: { topic: "Winter" },
      idempotencyKey: "form-1",
    };
    const a = await requestGeneration(admin, req, cfg);
    const b = await requestGeneration(admin, req, cfg);
    expect(b.id).toBe(a.id);
    expect(await prisma().aiJob.count()).toBe(1);
  });

  it("rejects invalid input per task", async () => {
    const { client, admin } = await world();
    await expect(
      requestGeneration(
        admin,
        { clientId: client.id, task: "seo_titles", input: { topic: "" } },
        cfg,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      requestGeneration(admin, { clientId: client.id, task: "poem", input: {} }, cfg),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("never trusting the output", () => {
  it("rejects a report summary that cites a figure it was not given", async () => {
    const { client, admin } = await world();
    const { id } = await requestGeneration(
      admin,
      {
        clientId: client.id,
        task: "report_summary",
        input: { periodStart: "2026-10-01", periodEnd: "2026-10-31" },
      },
      cfg,
    );
    const lying = JSON.stringify({
      summary: "Traffic grew 300%.",
      highlights: [],
      risks: [],
      nextSteps: [],
      figuresUsed: [{ label: "Search Console clicks", value: 99999 }],
    });
    const job = await run(id, createMockAiProvider({ raw: () => lying }));
    expect(job.status).toBe("queued");
    expect(job.error).toMatch(/not in the supplied data/);
  });

  it("warns about banned brand terms and keeps the result unverified", async () => {
    const { client, admin, agency } = await world();
    await prisma().brandGuideline.create({
      data: {
        agencyId: agency.id,
        clientId: client.id,
        name: "Voice",
        isActive: true,
        bannedTerms: ["placeholder"],
      },
    });
    const { id } = await requestGeneration(
      admin,
      { clientId: client.id, task: "blog_draft", input: topicInput },
      cfg,
    );
    const job = await run(id);
    const out = job.output as { warnings: string[]; unverified: boolean };
    expect(out.warnings.some((w) => w.includes("banned term"))).toBe(true);
    expect(out.unverified).toBe(true);
  });
});

describe("scoping and authorisation", () => {
  it("shows the model only this client's brand and approved sources", async () => {
    const { client, admin, agency } = await world();
    const other = await makeClient("Client Two", "client-two", agency.id);
    await prisma().brandGuideline.create({
      data: {
        agencyId: agency.id,
        clientId: other.id,
        name: "Other voice",
        isActive: true,
        toneOfVoice: "OTHER-TONE-MARKER",
      },
    });
    await prisma().brandGuideline.create({
      data: {
        agencyId: agency.id,
        clientId: client.id,
        name: "Our voice",
        isActive: true,
        toneOfVoice: "OUR-TONE-MARKER",
      },
    });
    await addApprovedSource(admin, other.id, { title: "Secret", body: "OTHER-CLIENT-SECRET-FACT" });
    await addApprovedSource(admin, client.id, { title: "Mine", body: "OUR-FACT" });
    const provider = createMockAiProvider();
    const { id } = await requestGeneration(
      admin,
      { clientId: client.id, task: "blog_draft", input: topicInput },
      cfg,
    );
    await run(id, provider);
    const sent = provider.calls[0]!.system + provider.calls[0]!.prompt;
    expect(sent).toContain("OUR-FACT");
    expect(sent).toContain("OUR-TONE-MARKER");
    expect(sent).not.toContain("OTHER-CLIENT-SECRET-FACT");
    expect(sent).not.toContain("OTHER-TONE-MARKER");
  });

  it("refuses another client's source, project, content or job", async () => {
    const { client, admin, agency } = await world();
    const other = await makeClient("Client Two", "client-two", agency.id);
    const foreign = await addApprovedSource(admin, other.id, { title: "Secret", body: "x" });
    const project = await prisma().project.create({
      data: {
        agencyId: agency.id,
        clientId: other.id,
        name: "P2",
        slug: "p2",
        kind: "general",
      } as never,
    });
    await expect(
      requestGeneration(
        admin,
        { clientId: client.id, task: "blog_draft", input: topicInput, sourceIds: [foreign.id] },
        cfg,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      requestGeneration(
        admin,
        { clientId: client.id, task: "blog_draft", input: topicInput, projectId: project.id },
        cfg,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      requestGeneration(
        admin,
        {
          clientId: client.id,
          task: "repurpose",
          input: { sourceContentItemId: crypto.randomUUID(), targetChannel: "x" },
        },
        cfg,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("another agency cannot read, list, regenerate or review a job", async () => {
    const { client, admin } = await world();
    const { id } = await requestGeneration(
      admin,
      { clientId: client.id, task: "hashtags", input: { topic: "x" } },
      cfg,
    );
    await run(id);
    const agency2 = await makeAgency("Agency Two");
    await makeClient("C2", "c2", agency2.id);
    const outsider = await makeUser();
    await addAgencyStaff(outsider, agency2.id, "agency_admin", true);
    await expect(getAiJob(outsider, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(regenerate(outsider, id, cfg)).rejects.toBeInstanceOf(NotFoundError);
    await expect(reviewAiJob(outsider, id, { outcome: "accepted" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await listAiJobs(outsider, {})).rows).toHaveLength(0);
  });

  it("people without ai.use cannot request, and only managers add sources", async () => {
    const { client } = await world();
    const viewer = await makeUser();
    await addMember(viewer, client.id, "client");
    await expect(
      requestGeneration(
        viewer,
        { clientId: client.id, task: "hashtags", input: { topic: "x" } },
        cfg,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const writer = await makeUser();
    await addMember(writer, client.id, "content_writer");
    await expect(
      addApprovedSource(writer, client.id, { title: "t", body: "b" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      requestGeneration(
        writer,
        { clientId: client.id, task: "hashtags", input: { topic: "x" } },
        cfg,
      ),
    ).resolves.toBeTruthy();
  });
});

describe("usage limits", () => {
  it("stops at the monthly request limit and at the cost limit", async () => {
    const { client, admin } = await world();
    await setAiLimit(admin, client.id, { monthlyRequests: 2, monthlyCostUsd: 0 });
    const req = { clientId: client.id, task: "hashtags", input: { topic: "x" } };
    await requestGeneration(admin, req, cfg);
    await requestGeneration(admin, req, cfg);
    await expect(requestGeneration(admin, req, cfg)).rejects.toThrow(/AI requests for the month/);
    await setAiLimit(admin, client.id, { monthlyRequests: 100, monthlyCostUsd: 1 });
    const job = await prisma().aiJob.findFirstOrThrow({});
    await prisma().aiUsageRecord.create({
      data: {
        agencyId: client.agencyId,
        clientId: client.id,
        aiJobId: job.id,
        provider: "x",
        model: "x",
        inputTokens: 1,
        outputTokens: 1,
        costMicros: 2_000_000n,
      },
    });
    await expect(requestGeneration(admin, req, cfg)).rejects.toThrow(/spending limit/);
  });

  it("limits requests per person per hour", async () => {
    const { client, admin } = await world();
    const tight = { ...cfg, perUserHourly: 1 };
    const req = { clientId: client.id, task: "hashtags", input: { topic: "x" } };
    await requestGeneration(admin, req, tight);
    await expect(requestGeneration(admin, req, tight)).rejects.toThrow(/last hour/);
  });
});

describe("regeneration, review and drafts", () => {
  it("regenerates with reviewer feedback and keeps the earlier job", async () => {
    const { client, admin } = await world();
    const { id } = await requestGeneration(
      admin,
      { clientId: client.id, task: "blog_draft", input: topicInput },
      cfg,
    );
    await run(id);
    await reviewAiJob(admin, id, {
      outcome: "needs_work",
      feedback: "Too salesy, add a how-to section",
    });
    const provider = createMockAiProvider();
    const next = await regenerate(admin, id, cfg);
    await run(next.id, provider);
    expect(provider.calls[0]!.prompt).toContain("Too salesy");
    const job = await prisma().aiJob.findUniqueOrThrow({ where: { id: next.id } });
    expect(job.parentJobId).toBe(id);
    expect((await prisma().aiJob.findUniqueOrThrow({ where: { id } })).reviewOutcome).toBe(
      "needs_work",
    );
  });

  it("requires feedback unless accepted", async () => {
    const { client, admin } = await world();
    const { id } = await requestGeneration(
      admin,
      { clientId: client.id, task: "hashtags", input: { topic: "x" } },
      cfg,
    );
    await run(id);
    await expect(reviewAiJob(admin, id, { outcome: "rejected" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await reviewAiJob(admin, id, { outcome: "accepted" });
  });

  it("saves output as a draft with an AI version, and edits and restores keep the history", async () => {
    const { client, admin } = await world();
    const { id } = await requestGeneration(
      admin,
      { clientId: client.id, task: "blog_draft", input: topicInput },
      cfg,
    );
    await run(id);
    const saved = await saveAiOutputAsDraft(admin, id, { channel: "website" });
    const item = await prisma().contentItem.findUniqueOrThrow({
      where: { id: saved.contentItemId },
    });
    expect(item.status).toBe("draft");
    expect(item.requiresApproval).toBe(true);
    const versions = await listContentVersions(admin, item.id);
    expect(versions[0]).toMatchObject({ versionNo: 1, authorKind: "ai", aiJobId: id });

    await saveContentVersion(admin, item.id, {
      title: "Edited",
      body: "Human edit.",
      expectedVersionNo: 1,
    });
    await expect(
      saveContentVersion(admin, item.id, { body: "Stale save", expectedVersionNo: 1 }),
    ).rejects.toThrow(/newer version/);
    await restoreContentVersion(admin, item.id, 1);
    const all = await listContentVersions(admin, item.id);
    expect(all.map((v) => v.versionNo)).toEqual([3, 2, 1]);
    expect(all[0]!.changeNote).toMatch(/Restored version 1/);
  });

  it("cannot save an unfinished generation, or a result meant only for reading", async () => {
    const { client, admin } = await world();
    const a = await requestGeneration(
      admin,
      { clientId: client.id, task: "blog_draft", input: topicInput },
      cfg,
    );
    await expect(saveAiOutputAsDraft(admin, a.id)).rejects.toThrow(/no result/);
    await run(a.id);
    const b = await requestGeneration(
      admin,
      { clientId: client.id, task: "seo_recommendations", input: { focus: "x" } },
      cfg,
    );
    await run(b.id);
    await expect(saveAiOutputAsDraft(admin, b.id)).rejects.toBeInstanceOf(ValidationError);
  });
});
