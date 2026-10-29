import { beforeEach, describe, expect, it } from "vitest";
import { makeClient, prisma, resetDb } from "../../test/helpers";
import { forEachActiveClient, runLogged } from "./job-runs";

beforeEach(resetDb);

describe("forEachActiveClient", () => {
  it("writes one job_runs row per active client and skips paused and archived", async () => {
    const a = await makeClient("A");
    const b = await makeClient("B");
    const paused = await makeClient("Paused");
    const archived = await makeClient("Archived");
    await prisma().client.update({ where: { id: paused.id }, data: { status: "paused" } });
    await prisma().client.update({ where: { id: archived.id }, data: { status: "archived" } });

    const seen: string[] = [];
    const result = await forEachActiveClient("heartbeat", async (c) => {
      seen.push(c.id);
    });

    expect(result).toEqual({ succeeded: 2, failed: 0 });
    expect(seen.sort()).toEqual([a.id, b.id].sort());
    const runs = await prisma().jobRun.findMany({ orderBy: { createdAt: "asc" } });
    expect(runs).toHaveLength(2);
    expect(
      runs.every((r) => r.jobName === "heartbeat" && r.status === "success" && r.finishedAt),
    ).toBe(true);
    expect(runs.map((r) => r.clientId).sort()).toEqual([a.id, b.id].sort());
  });

  it("records a failure and still runs the remaining clients", async () => {
    const a = await makeClient("A");
    await makeClient("B");
    const result = await forEachActiveClient("rank-check", async (c) => {
      if (c.id === a.id) throw new Error("boom");
    });

    expect(result).toEqual({ succeeded: 1, failed: 1 });
    const failed = await prisma().jobRun.findFirstOrThrow({ where: { status: "failed" } });
    expect(failed).toMatchObject({ clientId: a.id, error: "boom" });
    expect(await prisma().jobRun.count({ where: { status: "success" } })).toBe(1);
  });

  it("does nothing when there are no active clients", async () => {
    expect(await forEachActiveClient("heartbeat", async () => {})).toEqual({
      succeeded: 0,
      failed: 0,
    });
    expect(await prisma().jobRun.count()).toBe(0);
  });
});

describe("runLogged", () => {
  it("rethrows the original error after recording it", async () => {
    const c = await makeClient("A");
    await expect(
      runLogged("x", c.id, async () => Promise.reject(new Error("nope"))),
    ).rejects.toThrow("nope");
    expect(await prisma().jobRun.count({ where: { status: "failed" } })).toBe(1);
  });
});
