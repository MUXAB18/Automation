import { describe, expect, it } from "vitest";
import { resolveRange } from "./analytics-range";

const NOW = Date.parse("2026-04-10T15:00:00Z");

describe("resolveRange", () => {
  it("defaults to the last 28 complete days, ending yesterday", () => {
    expect(resolveRange({}, NOW)).toEqual({
      from: "2026-03-13",
      to: "2026-04-09",
      preset: "28d",
      days: 28,
    });
  });
  it("supports presets and ignores unknown ones", () => {
    expect(resolveRange({ range: "7d" }, NOW)).toMatchObject({
      from: "2026-04-03",
      to: "2026-04-09",
      days: 7,
    });
    expect(resolveRange({ range: "90d" }, NOW).days).toBe(90);
    expect(resolveRange({ range: "weird" }, NOW).preset).toBe("28d");
  });
  it("accepts a custom range, never past yesterday, swaps reversed dates, and caps the length", () => {
    expect(resolveRange({ from: "2026-04-01", to: "2026-04-05" }, NOW)).toEqual({
      from: "2026-04-01",
      to: "2026-04-05",
      preset: "custom",
      days: 5,
    });
    expect(resolveRange({ from: "2026-04-01", to: "2026-05-01" }, NOW).to).toBe("2026-04-09");
    expect(resolveRange({ from: "2026-04-05", to: "2026-04-01" }, NOW)).toMatchObject({
      from: "2026-04-01",
      to: "2026-04-05",
    });
    expect(resolveRange({ from: "2020-01-01", to: "2026-04-09" }, NOW).days).toBe(400);
  });
  it("ignores malformed custom dates", () => {
    expect(resolveRange({ from: "nope", to: "2026-04-05" }, NOW).preset).toBe("28d");
  });
});
