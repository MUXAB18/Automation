import { describe, expect, it } from "vitest";
import { addDays, isDay, rangeFor, shift, titleFor, weekStart } from "./calendar";

describe("calendar ranges", () => {
  it("weeks start on Monday", () => {
    expect(weekStart("2026-11-04")).toBe("2026-11-02"); // Wednesday
    expect(weekStart("2026-11-08")).toBe("2026-11-02"); // Sunday
    expect(weekStart("2026-11-02")).toBe("2026-11-02");
  });
  it("a month grid is whole weeks covering the month", () => {
    const r = rangeFor("month", "2026-11-15");
    expect(r.from).toBe("2026-10-26");
    expect(r.to).toBe("2026-12-06");
    expect(r.days.length % 7).toBe(0);
    expect(r.days).toContain("2026-11-30");
  });
  it("week and day ranges", () => {
    expect(rangeFor("week", "2026-11-04")).toMatchObject({ from: "2026-11-02", to: "2026-11-08" });
    expect(rangeFor("day", "2026-11-04").days).toEqual(["2026-11-04"]);
  });
  it("navigates across month and year boundaries", () => {
    expect(shift("month", "2026-12-20", 1)).toBe("2027-01-01");
    expect(shift("month", "2026-01-20", -1)).toBe("2025-12-01");
    expect(shift("week", "2026-12-30", 1)).toBe("2027-01-06");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
  it("validates days and titles", () => {
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("2026-02-28")).toBe(true);
    expect(titleFor("month", "2026-11-15")).toMatch(/November 2026/);
  });
});
