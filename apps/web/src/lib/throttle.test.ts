import { beforeEach, describe, expect, it, vi } from "vitest";

const count = vi.fn<(q: unknown) => Promise<number>>();
const record = vi.fn<(e: unknown) => Promise<void>>();
vi.mock("@automation/db", () => ({
  countSecurityEvents: (q: unknown) => count(q),
  recordSecurityEvent: (e: unknown) => record(e),
}));

import { consumeUserQuota, emailKey } from "./throttle";

describe("consumeUserQuota", () => {
  beforeEach(() => {
    count.mockReset();
    record.mockReset().mockResolvedValue();
  });

  it("allows and records while under the limit", async () => {
    count.mockResolvedValue(2);
    expect(await consumeUserQuota("quota.x", "u1", 3)).toBe(true);
    expect(record).toHaveBeenCalledOnce();
  });

  it("refuses without recording once the limit is reached", async () => {
    count.mockResolvedValue(3);
    expect(await consumeUserQuota("quota.x", "u1", 3)).toBe(false);
    expect(record).not.toHaveBeenCalled();
  });

  it("counts per user and action", async () => {
    count.mockResolvedValue(0);
    await consumeUserQuota("quota.x", "u9", 3);
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quota.x", entityId: "u9" }),
    );
  });
});

describe("emailKey", () => {
  it("is stable, case-insensitive and does not contain the email", () => {
    expect(emailKey("User@Example.com ")).toBe(emailKey("user@example.com"));
    expect(emailKey("a@example.com")).not.toBe(emailKey("b@example.com"));
    expect(emailKey("user@example.com")).toMatch(/^[0-9a-f]{32}$/);
    expect(emailKey("user@example.com")).not.toContain("user");
  });
});
