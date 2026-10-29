import { describe, expect, it } from "vitest";
import {
  createClientSchema,
  createProjectSchema,
  updateClientSchema,
  updateProjectSchema,
} from "@automation/db";
import { clientInput, projectInput } from "./form-input";

/** Build FormData the way the browser posts the forms (multi-value fields repeat). */
function form(fields: [string, string][]): FormData {
  const data = new FormData();
  for (const [k, v] of fields) data.append(k, v);
  return data;
}

describe("client form -> schema", () => {
  const fields: [string, string][] = [
    ["name", " Acme Freight "],
    ["primaryDomain", "https://www.acme.ca"],
    ["industry", "Logistics"],
    ["goals", "Get more quotes"],
    ["targetLocations", "Ottawa, ON\nToronto, ON"],
    ["timezone", "America/Toronto"],
    ["locale", "fr-CA"],
    ["reportEmail", "ops@acme.ca"],
    ["reportIntervalDays", "30"],
    ["preferences.reportDelivery", "download"],
    ["preferences.reportWeekday", "3"],
    ["preferences.weeklySummary", "on"],
  ];

  it("posts exactly what the create schema accepts", () => {
    const parsed = createClientSchema.parse(clientInput(form(fields)));
    expect(parsed).toMatchObject({
      name: "Acme Freight",
      primaryDomain: "www.acme.ca",
      targetLocations: ["Ottawa, ON", "Toronto, ON"],
      locale: "fr-CA",
      reportIntervalDays: 30,
      preferences: { reportDelivery: "download", reportWeekday: 3, weeklySummary: true },
    });
  });

  it("treats empty optional fields and an unticked checkbox as 'not set'", () => {
    const parsed = createClientSchema.parse(
      clientInput(
        form([
          ["name", "Acme"],
          ["industry", ""],
          ["goals", ""],
          ["reportEmail", ""],
          ["preferences.reportWeekday", ""],
          ["reportIntervalDays", "15"],
        ]),
      ),
    );
    expect(parsed.industry).toBeUndefined();
    expect(parsed.reportEmail).toBeUndefined();
    expect(parsed.preferences).toEqual({
      reportDelivery: "email",
      reportWeekday: undefined,
      weeklySummary: false,
    });
  });

  it("works for the edit form too", () => {
    expect(updateClientSchema.parse(clientInput(form([...fields, ["slug", "acme"]]))).slug).toBe(
      "acme",
    );
  });
});

describe("project form -> schema", () => {
  const base: [string, string][] = [
    ["clientId", "c1"],
    ["name", "Spring"],
    ["kind", "seo"],
    ["status", "active"],
    ["goals", "Rank"],
    ["startsOn", "2026-03-01"],
    ["endsOn", "2026-06-01"],
    ["memberIds", "u1"],
    ["memberIds", "u2"],
    ["seoEnabled", "on"],
    ["seo.websiteId", "w1"],
    ["seo.targetCountry", "ca"],
    ["seo.targetLanguage", "en"],
    ["seo.keywords", "Freight\nCustoms"],
    ["seo.organicSessionsGoal", "5000"],
    ["seo.topTenKeywordsGoal", ""],
    ["socialEnabled", "on"],
    ["social.channels", "linkedin"],
    ["social.channels", "facebook"],
    ["social.postsPerWeek", "4"],
    ["social.requirements", "CTA"],
  ];
  const input = (fields: [string, string][]) => ({ clientId: "c1", ...projectInput(form(fields)) });

  it("posts exactly what the create schema accepts", () => {
    const parsed = createProjectSchema.parse(input(base));
    expect(parsed.memberIds).toEqual(["u1", "u2"]);
    expect(parsed.seo).toMatchObject({
      websiteId: "w1",
      targetCountry: "CA",
      keywords: ["freight", "customs"],
      organicSessionsGoal: 5000,
    });
    expect(parsed.seo?.topTenKeywordsGoal).toBeUndefined();
    expect(parsed.social).toMatchObject({ channels: ["linkedin", "facebook"], postsPerWeek: 4 });
    expect(parsed.startsOn?.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(updateProjectSchema.parse(projectInput(form(base))).name).toBe("Spring");
  });

  it("leaves SEO and social out unless their sections are switched on", () => {
    const parsed = createProjectSchema.parse(
      input([
        ["name", "Plain"],
        ["kind", "general"],
        ["seo.websiteId", "w1"],
        ["social.channels", "x"],
      ]),
    );
    expect(parsed.seo).toBeUndefined();
    expect(parsed.social).toBeUndefined();
    expect(parsed.memberIds).toEqual([]);
  });

  it("surfaces the same field names the form displays errors under", () => {
    const result = createProjectSchema.safeParse(
      input([
        ["name", ""],
        ["kind", "seo"],
        ["startsOn", "2026-05-01"],
        ["endsOn", "2026-04-01"],
        ["seoEnabled", "on"],
        ["seo.websiteId", ""],
      ]),
    );
    expect(result.success).toBe(false);
    const keys = new Set(result.error?.issues.map((i) => i.path.join(".")));
    expect(keys).toEqual(new Set(["name", "endsOn", "seo.websiteId"]));
  });
});
