import { describe, expect, it } from "vitest";
import {
  daysOfMonth,
  dateInTimeZone,
  endOfDayInTimeZone,
  isMonth,
  startOfDayInTimeZone,
} from "./dates";

describe("end of a due day in the client's time zone", () => {
  it("is 04:59 UTC the next day in Toronto in winter (UTC-5) and 03:59 in summer (UTC-4)", () => {
    expect(endOfDayInTimeZone("2026-01-15", "America/Toronto").toISOString()).toBe(
      "2026-01-16T04:59:59.999Z",
    );
    expect(endOfDayInTimeZone("2026-07-15", "America/Toronto").toISOString()).toBe(
      "2026-07-16T03:59:59.999Z",
    );
  });

  it("handles the day clocks go forward and back", () => {
    expect(endOfDayInTimeZone("2026-03-08", "America/Toronto").toISOString()).toBe(
      "2026-03-09T03:59:59.999Z",
    );
    expect(endOfDayInTimeZone("2026-11-01", "America/Toronto").toISOString()).toBe(
      "2026-11-02T04:59:59.999Z",
    );
  });

  it("works for UTC and for zones ahead of UTC", () => {
    expect(endOfDayInTimeZone("2026-06-01", "UTC").toISOString()).toBe("2026-06-01T23:59:59.999Z");
    expect(endOfDayInTimeZone("2026-06-01", "Asia/Tokyo").toISOString()).toBe(
      "2026-06-01T14:59:59.999Z",
    );
  });

  it("has a matching start of day, and the two days are adjacent", () => {
    expect(startOfDayInTimeZone("2026-01-15", "America/Toronto").toISOString()).toBe(
      "2026-01-15T05:00:00.000Z",
    );
    expect(
      startOfDayInTimeZone("2026-01-16", "America/Toronto").getTime() -
        endOfDayInTimeZone("2026-01-15", "America/Toronto").getTime(),
    ).toBe(1);
  });
});

describe("calendar helpers", () => {
  it("names the local calendar day of an instant", () => {
    const instant = new Date("2026-01-16T03:30:00Z"); // still the 15th in Toronto
    expect(dateInTimeZone(instant, "America/Toronto")).toBe("2026-01-15");
    expect(dateInTimeZone(instant, "UTC")).toBe("2026-01-16");
  });

  it("lists the days of a month, including leap years", () => {
    expect(daysOfMonth("2026-02")).toHaveLength(28);
    expect(daysOfMonth("2028-02")).toHaveLength(29);
    expect(daysOfMonth("2026-12").at(-1)).toBe("2026-12-31");
  });

  it("validates month strings", () => {
    expect(isMonth("2026-05")).toBe(true);
    for (const bad of ["2026-13", "2026-5", "26-05", "2026-00", "May 2026", ""])
      expect(isMonth(bad)).toBe(false);
  });
});
