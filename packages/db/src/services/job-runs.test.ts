import { beforeEach, describe, expect, it } from "vitest";
import { makeCustomer, prisma, resetDb } from "../../test/helpers";
import { forEachActiveCustomer, runLogged } from "./job-runs";

beforeEach(resetDb);

describe("forEachActiveCustomer", () => {
  it("writes one job_runs row per active customer and skips paused and archived", async () => {
    const a = await makeCustomer("A");
    const b = await makeCustomer("B");
    const paused = await makeCustomer("Paused");
    const archived = await makeCustomer("Archived");
    await prisma().customer.update({ where: { id: paused.id }, data: { status: "paused" } });
    await prisma().customer.update({ where: { id: archived.id }, data: { status: "archived" } });

    const seen: string[] = [];
    const result = await forEachActiveCustomer("heartbeat", async (c) => {
      seen.push(c.id);
    });

    expect(result).toEqual({ succeeded: 2, failed: 0 });
    expect(seen.sort()).toEqual([a.id, b.id].sort());
    const runs = await prisma().jobRun.findMany({ orderBy: { createdAt: "asc" } });
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.jobName === "heartbeat" && r.status === "success" && r.finishedAt)).toBe(true);
    expect(runs.map((r) => r.customerId).sort()).toEqual([a.id, b.id].sort());
  });

  it("records a failure and still runs the remaining customers", async () => {
    const a = await makeCustomer("A");
    await makeCustomer("B");
    const result = await forEachActiveCustomer("rank-check", async (c) => {
      if (c.id === a.id) throw new Error("boom");
    });

    expect(result).toEqual({ succeeded: 1, failed: 1 });
    const failed = await prisma().jobRun.findFirstOrThrow({ where: { status: "failed" } });
    expect(failed).toMatchObject({ customerId: a.id, error: "boom" });
    expect(await prisma().jobRun.count({ where: { status: "success" } })).toBe(1);
  });

  it("does nothing when there are no active customers", async () => {
    expect(await forEachActiveCustomer("heartbeat", async () => {})).toEqual({ succeeded: 0, failed: 0 });
    expect(await prisma().jobRun.count()).toBe(0);
  });
});

describe("runLogged", () => {
  it("rethrows the original error after recording it", async () => {
    const c = await makeCustomer("A");
    await expect(runLogged("x", c.id, async () => Promise.reject(new Error("nope")))).rejects.toThrow("nope");
    expect(await prisma().jobRun.count({ where: { status: "failed" } })).toBe(1);
  });
});
