import { describe, expect, it } from "vitest";
import { formatDuration, mockAllowed, missingScopes } from "./integration-view";

describe("integration view helpers", () => {
  it("finds missing scopes", () => {
    expect(missingScopes(["a"], ["a", "b"])).toEqual(["b"]);
    expect(missingScopes(["a", "b"], ["a"])).toEqual([]);
  });
  it("allows the mock outside production only unless opted in", () => {
    expect(mockAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(mockAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(mockAllowed({ NODE_ENV: "production", ALLOW_MOCK_INTEGRATIONS: "1" })).toBe(true);
  });
  it("formats durations", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(250)).toBe("250 ms");
    expect(formatDuration(65_000)).toBe("1 min 5 s");
  });
});
