import PDFDocument from "pdfkit";
import type { ReportView } from "@automation/db";

type M = {
  label: string;
  unit: string;
  value: number | null;
  previous: number | null;
  changePct: number | null;
  state: string;
  note?: string;
};

const INDIGO = "#4f46e5";
const GREY = "#6b7280";

function fmtValue(m: M): string {
  if (m.value === null) return m.state === "no_source" ? "Not connected" : "No data";
  const v =
    m.unit === "percent"
      ? `${m.value.toFixed(1)}%`
      : m.unit === "position"
        ? m.value.toFixed(1)
        : m.unit === "usd"
          ? `$${m.value.toFixed(2)}`
          : m.value.toLocaleString("en-CA", { maximumFractionDigits: 0 });
  return m.state === "partial" ? `${v} (partial)` : v;
}
const fmtChange = (m: M) =>
  m.changePct === null ? "" : `${m.changePct >= 0 ? "+" : ""}${m.changePct.toFixed(0)}%`;
const metricOf = (x: unknown): M | null =>
  x && typeof x === "object" && "label" in x && "state" in x ? (x as M) : null;

/** The text version of a report: used for the email body and as the accessible plain rendering. */
export function renderReportText(view: ReportView): string {
  const lines: string[] = [
    view.title,
    `${view.periodStart} to ${view.periodEnd} (${view.timezone})`,
    "",
  ];
  for (const s of view.sections) {
    lines.push(s.title.toUpperCase());
    const c = s.content as Record<string, unknown>;
    if (s.key === "summary") lines.push(String(c.text ?? ""));
    else if (s.key === "recommendations")
      for (const r of (c.items as { title: string; reason: string }[]) ?? [])
        lines.push(`- ${r.title}: ${r.reason}`);
    else if (s.key === "data_sources") {
      for (const x of (c.sources as {
        label: string;
        dataThrough: string | null;
        stale: boolean;
      }[]) ?? [])
        lines.push(
          `- ${x.label}: data through ${x.dataThrough ?? "unknown"}${x.stale ? " (stale)" : ""}`,
        );
      lines.push(String(c.note ?? ""));
    } else {
      for (const m of collectMetrics(c))
        lines.push(`- ${m.label}: ${fmtValue(m)}${fmtChange(m) ? ` (${fmtChange(m)})` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function collectMetrics(c: Record<string, unknown>): M[] {
  const out: M[] = [];
  const walk = (x: unknown, depth: number) => {
    const m = metricOf(x);
    if (m) return void out.push(m);
    if (depth > 2 || !x || typeof x !== "object" || Array.isArray(x)) return;
    for (const v of Object.values(x)) walk(v, depth + 1);
  };
  walk(c, 0);
  return out;
}

/** A readable, text-and-table PDF made only from the report's stored sections. */
export function renderReportPdf(view: ReportView): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      bufferPages: true,
      info: { Title: view.title, Author: "SEO & Social Automation" },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fillColor(INDIGO).fontSize(22).text(view.title, { align: "left" });
    doc
      .moveDown(0.3)
      .fillColor(GREY)
      .fontSize(10)
      .text(
        `${view.clientName} · ${view.periodStart} to ${view.periodEnd} (${view.timezone})${view.generatedAt ? ` · generated ${view.generatedAt.slice(0, 10)}` : ""}`,
      );
    doc.moveDown(1);

    const heading = (t: string) => {
      doc.moveDown(0.8).fillColor(INDIGO).fontSize(14).text(t);
      doc.moveDown(0.3).fillColor("#111827").fontSize(10);
    };
    const row = (cols: string[], widths: number[], bold = false) => {
      const y = doc.y;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica");
      let x = doc.page.margins.left;
      cols.forEach((c, i) => {
        doc.text(c, x, y, { width: widths[i]! - 6, lineBreak: false, ellipsis: true });
        x += widths[i]!;
      });
      doc.y = y + 15;
      doc.x = doc.page.margins.left;
    };
    const metricTable = (ms: M[]) => {
      const w = [210, 110, 80, 90];
      row(["Metric", "Value", "Change", "Status"], w, true);
      for (const m of ms) {
        if (doc.y > doc.page.height - 90) doc.addPage();
        row(
          [
            m.label,
            fmtValue(m),
            fmtChange(m),
            m.state === "ok"
              ? ""
              : m.state === "partial"
                ? "Partial data"
                : m.state === "no_source"
                  ? "Not connected"
                  : "No data",
          ],
          w,
        );
        if (m.note && m.state !== "ok") {
          doc
            .fillColor(GREY)
            .fontSize(8)
            .text(m.note, doc.page.margins.left + 10, doc.y - 3, { width: 440 });
          doc.fillColor("#111827").fontSize(10);
          doc.moveDown(0.2);
        }
      }
    };
    const bullets = (items: string[]) =>
      items.forEach((i) => doc.font("Helvetica").text(`• ${i}`, { indent: 6, width: 480 }));

    for (const s of view.sections) {
      if (doc.y > doc.page.height - 140) doc.addPage();
      heading(s.title);
      const c = s.content as Record<string, unknown>;
      if (s.key === "summary") {
        doc.font("Helvetica").text(String(c.text ?? ""), { width: 490 });
        if (s.aiGenerated)
          doc
            .moveDown(0.4)
            .fillColor(GREY)
            .fontSize(8)
            .text(
              "This summary was drafted by AI from the figures in this report and reviewed by a person before it was sent.",
            )
            .fillColor("#111827")
            .fontSize(10);
      } else if (s.key === "recommendations") {
        const items = (c.items as { title: string; reason: string }[]) ?? [];
        if (items.length === 0)
          doc.font("Helvetica").text("No recommendations arise from this period's figures.");
        else bullets(items.map((r) => `${r.title}. ${r.reason}`));
      } else if (s.key === "data_sources") {
        bullets(
          (
            (c.sources as { label: string; dataThrough: string | null; stale: boolean }[]) ?? []
          ).map(
            (x) =>
              `${x.label}: data through ${x.dataThrough ?? "unknown"}${x.stale ? " (stale)" : ""}`,
          ),
        );
        doc
          .moveDown(0.4)
          .fillColor(GREY)
          .fontSize(8)
          .text(String(c.note ?? ""), { width: 490 })
          .fillColor("#111827")
          .fontSize(10);
      } else if (s.key === "seo") {
        const r = c.rankings as {
          tracked: number;
          improved: number;
          declined: number;
          unchanged: number;
          withChange: number;
          avgPositionStart: number | null;
          avgPositionEnd: number | null;
          topImproved: { term: string; from: number; to: number }[];
          topDeclined: { term: string; from: number; to: number }[];
          note?: string;
          state: string;
        };
        if (!r || r.tracked === 0)
          doc.font("Helvetica").text(r?.note ?? "No keywords are tracked.");
        else {
          doc
            .font("Helvetica")
            .text(
              `${r.tracked} keywords tracked; ${r.withChange} with a comparison: ${r.improved} up, ${r.declined} down, ${r.unchanged} unchanged.${r.avgPositionStart !== null && r.avgPositionEnd !== null ? ` Average position ${r.avgPositionStart.toFixed(1)} to ${r.avgPositionEnd.toFixed(1)}.` : ""}`,
            );
          if (r.note) doc.fillColor(GREY).text(r.note).fillColor("#111827");
          if (r.topImproved.length) {
            doc.moveDown(0.3).font("Helvetica-Bold").text("Biggest gains");
            bullets(
              r.topImproved.map((k) => `${k.term}: ${k.from.toFixed(1)} → ${k.to.toFixed(1)}`),
            );
          }
          if (r.topDeclined.length) {
            doc.moveDown(0.3).font("Helvetica-Bold").text("Biggest drops");
            bullets(
              r.topDeclined.map((k) => `${k.term}: ${k.from.toFixed(1)} → ${k.to.toFixed(1)}`),
            );
          }
        }
        const m = metricOf(c.issuesResolved);
        if (m) {
          doc.moveDown(0.5);
          metricTable([m]);
        }
      } else if (s.key === "social") {
        const ms = collectMetrics({ published: c.published });
        metricTable(ms);
        const e = c.engagement as {
          impressions: number | null;
          reach: number | null;
          likes: number | null;
          comments: number | null;
          shares: number | null;
          clicks: number | null;
          note: string;
          state: string;
        };
        doc.moveDown(0.4).font("Helvetica");
        if (e?.state === "no_data")
          doc.fillColor(GREY).text(`Engagement: ${e.note}`).fillColor("#111827");
        else if (e)
          doc.text(
            `Engagement (latest readings): ${["impressions", "reach", "likes", "comments", "shares", "clicks"].map((k) => `${(e as unknown as Record<string, number | null>)[k] ?? 0} ${k}`).join(", ")}. ${e.note}`,
            { width: 490 },
          );
      } else if (s.key === "work") {
        metricTable(collectMetrics({ completed: c.completed, created: c.created }));
        const t = (c.completedTasks as string[]) ?? [];
        if (t.length) {
          doc.moveDown(0.4).font("Helvetica-Bold").text("Completed");
          bullets(t);
        }
      } else if (s.key === "issues") {
        const o = c.open as Record<string, number>;
        doc
          .font("Helvetica")
          .text(
            `Open SEO issues: ${o?.critical ?? 0} critical, ${o?.high ?? 0} high, ${o?.medium ?? 0} medium, ${o?.low ?? 0} low.`,
          );
        const top = (c.top as { title: string; severity: string }[]) ?? [];
        if (top.length) bullets(top.map((i) => `[${i.severity}] ${i.title}`));
        const ig = (c.integrations as { provider: string; status: string }[]) ?? [];
        if (ig.length) {
          doc.moveDown(0.3).font("Helvetica-Bold").text("Connections needing attention");
          bullets(ig.map((i) => `${i.provider}: ${i.status.replace("_", " ")}`));
        }
      } else {
        metricTable(collectMetrics(c));
      }
    }
    // Page numbers.
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc
        .fillColor(GREY)
        .fontSize(8)
        .text(`${view.title} · page ${i + 1} of ${range.count}`, 48, doc.page.height - 32, {
          width: doc.page.width - 96,
          align: "center",
          lineBreak: false,
        });
    }
    doc.end();
  });
}
