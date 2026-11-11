import { describe, expect, it } from "vitest";
import { buildHealth } from "./health";

const up = { database: true, redis: true };
const NOW = 10_000_000;

describe("worker health", () => {
  it("is ok when dependencies are up and loops ticked recently", () => {
    const h = buildHealth(
      up,
      [{ name: "sync", everyMs: 15_000, lastTickAt: NOW - 20_000 }],
      NOW,
      0,
    );
    expect(h.status).toBe("ok");
    expect(h.loops[0]).toMatchObject({ stale: false, ageSeconds: 20 });
  });

  it("is an error when the database or Redis is unreachable", () => {
    const loops = [{ name: "sync", everyMs: 15_000, lastTickAt: NOW }];
    expect(buildHealth({ database: false, redis: true }, loops, NOW, 0).status).toBe("error");
    expect(buildHealth({ database: true, redis: false }, loops, NOW, 0).status).toBe("error");
  });

  it("is degraded when a loop has stopped ticking", () => {
    const h = buildHealth(
      up,
      [{ name: "sync", everyMs: 15_000, lastTickAt: NOW - 600_000 }],
      NOW,
      0,
    );
    expect(h.status).toBe("degraded");
    expect(h.loops[0]!.stale).toBe(true);
  });

  it("gives a fresh start time to tick before calling a loop stale", () => {
    const loops = [{ name: "reports", everyMs: 60_000, lastTickAt: null }];
    expect(buildHealth(up, loops, NOW, NOW - 30_000).status).toBe("ok");
    expect(buildHealth(up, loops, NOW, NOW - 3_600_000).status).toBe("degraded");
  });
});
