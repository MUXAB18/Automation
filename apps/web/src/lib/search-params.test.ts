import { describe, expect, it } from "vitest";
import { sectionForPath, SECTIONS } from "./nav";
import { flag, oneOf, page, str } from "./search-params";

describe("search params", () => {
  it("narrows untrusted values", () => {
    expect(str(" hello ")).toBe("hello");
    expect(str("x".repeat(500))).toHaveLength(100);
    expect(str(["a", "b"])).toBe("a");
    expect(str("   ")).toBeUndefined();
    expect(page("3")).toBe(3);
    expect(page("-4")).toBe(1);
    expect(page("abc")).toBe(1);
    expect(page(undefined)).toBe(1);
    expect(flag("1")).toBe(true);
    expect(flag("true")).toBe(false);
    expect(oneOf("done", ["todo", "done"] as const)).toBe("done");
    expect(oneOf("'; drop table", ["todo", "done"] as const)).toBeUndefined();
  });
});

describe("navigation", () => {
  it("defines the 13 sections once each, with unique paths", () => {
    expect(SECTIONS).toHaveLength(13);
    expect(new Set(SECTIONS.map((s) => s.href)).size).toBe(13);
    expect(new Set(SECTIONS.map((s) => s.key)).size).toBe(13);
  });

  it("maps URLs to sections", () => {
    expect(sectionForPath("/")).toBe("overview");
    expect(sectionForPath("/clients/abc")).toBe("clients");
    expect(sectionForPath("/clients/new")).toBe("clients");
    expect(sectionForPath("/social")).toBe("social");
    expect(sectionForPath("/team")).toBe("team");
    expect(sectionForPath("/login")).toBeUndefined();
    expect(sectionForPath("/clientsx")).toBeUndefined();
  });
});
