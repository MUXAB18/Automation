import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it("keeps same-site paths", () => {
    expect(safeRedirectPath("/invite/abc")).toBe("/invite/abc");
    expect(safeRedirectPath("/clients?x=1#y")).toBe("/clients?x=1#y");
  });

  it.each([
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "javascript:alert(1)",
    "evil.com",
    "/ok\nHeader: x",
    "",
    undefined,
    5,
  ])("rejects %s", (value) => {
    expect(safeRedirectPath(value)).toBe("/");
  });
});
