import { describe, expect, it } from "vitest";
import { emailKey } from "./throttle";

describe("emailKey", () => {
  it("is stable, case-insensitive and does not contain the email", () => {
    expect(emailKey("User@Example.com ")).toBe(emailKey("user@example.com"));
    expect(emailKey("a@example.com")).not.toBe(emailKey("b@example.com"));
    expect(emailKey("user@example.com")).toMatch(/^[0-9a-f]{32}$/);
    expect(emailKey("user@example.com")).not.toContain("user");
  });
});
