import { describe, expect, it } from "vitest";
import type { ReportView } from "@automation/db";
import { renderReportPdf, renderReportText } from "./index";

const metric = (label: string, value: number | null, extra = {}) => ({
  key: label,
  label,
  unit: "count",
  value,
  previous: null,
  changePct: null,
  state: value === null ? "no_data" : "ok",
  ...extra,
});

const view: ReportView = {
  id: "r1",
  title: "Client report: 2026-11-01 to 2026-11-15",
  status: "approved",
  clientName: "Client A",
  timezone: "America/Toronto",
  periodStart: "2026-11-01",
  periodEnd: "2026-11-15",
  generatedAt: "2026-11-16T14:00:00.000Z",
  revision: 1,
  sections: [
    {
      key: "summary",
      title: "Executive summary",
      aiGenerated: true,
      content: { text: "Clicks were 1500." },
    },
    {
      key: "search_traffic",
      title: "Search and traffic performance",
      aiGenerated: false,
      content: {
        search: {
          clicks: metric("Organic clicks", 1500, { previous: 750, changePct: 100 }),
          impressions: metric("Impressions", null, {
            note: "No Search Console data was synced for this period.",
          }),
        },
        traffic: {},
      },
    },
    {
      key: "recommendations",
      title: "Recommendations",
      aiGenerated: false,
      content: { items: [{ title: "Fix issues", reason: "3 are open." }] },
    },
    {
      key: "data_sources",
      title: "Data sources and freshness",
      aiGenerated: false,
      content: {
        sources: [{ label: "Search Console: a.ca", dataThrough: "2026-11-15", stale: false }],
        note: "Nothing is estimated.",
      },
    },
  ],
};

describe("report rendering", () => {
  it("renders a real PDF", async () => {
    const pdf = await renderReportPdf(view);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1500);
  });
  it("renders a PDF for a report where every section is empty", async () => {
    const pdf = await renderReportPdf({
      ...view,
      sections: view.sections.map((s) => ({ ...s, content: {} })),
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
  it("the text version states values, changes and missing data without inventing any", () => {
    const text = renderReportText(view);
    expect(text).toContain("Organic clicks: 1,500 (+100%)");
    expect(text).toContain("Impressions: No data");
    expect(text).toContain("data through 2026-11-15");
    expect(text).not.toMatch(/Impressions: 0/);
  });
});
