import { describe, expect, it } from "vitest";
import { ValidationError } from "./errors";
import { createCustomerSchema, normalizeDomain, parseInput, slugify } from "./schemas";

describe("normalizeDomain", () => {
  it("strips protocol, path, port and case", () => {
    expect(normalizeDomain(" HTTPS://SarjWorldwide.ca:8080/a?b=1 ")).toBe("sarjworldwide.ca");
  });
});

describe("slugify", () => {
  it("makes url-safe slugs", () => {
    expect(slugify("SARJ Worldwide")).toBe("sarj-worldwide");
    expect(slugify("Café & Co.")).toBe("cafe-co");
  });
  it("never returns a too-short slug", () => {
    expect(slugify("!").length).toBeGreaterThanOrEqual(2);
  });
});

describe("createCustomerSchema", () => {
  it("applies defaults and normalizes the domain", () => {
    const data = parseInput(createCustomerSchema, { name: "Acme", primaryDomain: "https://Acme.com/" });
    expect(data.reportIntervalDays).toBe(15);
    expect(data.primaryDomain).toBe("acme.com");
    expect(data.slug).toBeUndefined();
  });

  it("treats empty optional fields as absent", () => {
    const data = parseInput(createCustomerSchema, { name: "Acme", slug: "", reportEmail: "", primaryDomain: "" });
    expect(data.reportEmail).toBeUndefined();
  });

  it("reports field errors", () => {
    try {
      parseInput(createCustomerSchema, { name: "", reportEmail: "nope", reportIntervalDays: 0 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const fields = Object.keys((error as ValidationError).fieldErrors);
      expect(fields).toEqual(expect.arrayContaining(["name", "reportEmail", "reportIntervalDays"]));
    }
  });
});
