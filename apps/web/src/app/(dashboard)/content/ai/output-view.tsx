import { AlertTriangle } from "lucide-react";
import { TASK_LABEL, type AiTask } from "@automation/db";

type Out = { result: Record<string, unknown>; warnings: string[]; disclaimer: string };
const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const s = (v: unknown) => String(v ?? "");

function Bullets({ items }: { items: unknown[] }) {
  return items.length ? (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((i, n) => (
        <li key={n}>{s(i)}</li>
      ))}
    </ul>
  ) : null;
}

/** Renders a validated result. Always labelled as an unverified AI draft; claims to check are listed beside it. */
export function OutputView({ task, output }: { task: AiTask; output: Out }) {
  const r = output.result;
  const claims = list(r.claimsToVerify);
  return (
    <div className="grid gap-4">
      <div
        role="note"
        className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>{output.disclaimer}</p>
      </div>
      {output.warnings.length ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">
          {output.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      <section aria-label={TASK_LABEL[task]} className="grid gap-3">
        {task === "content_brief" ? (
          <>
            <h3 className="text-lg font-semibold">{s(r.title)}</h3>
            <p className="text-sm">
              <span className="text-muted-foreground">Search intent:</span> {s(r.searchIntent)}
            </p>
            {list(r.outline).map((o, n) => {
              const x = o as { heading: string; points: string[] };
              return (
                <div key={n}>
                  <p className="font-medium">{x.heading}</p>
                  <Bullets items={x.points} />
                </div>
              );
            })}
            <div>
              <p className="font-medium">Key points</p>
              <Bullets items={list(r.keyPoints)} />
            </div>
            {list(r.faqs).length ? (
              <div>
                <p className="font-medium">FAQs</p>
                <Bullets
                  items={list(r.faqs).map(
                    (f) =>
                      `${(f as { question: string }).question} ${(f as { answerOutline: string }).answerOutline}`,
                  )}
                />
              </div>
            ) : null}
          </>
        ) : null}
        {task === "blog_draft" ? (
          <>
            <h3 className="text-lg font-semibold">{s(r.title)}</h3>
            <p className="text-sm text-muted-foreground">
              Meta description: {s(r.metaDescription)}
            </p>
            <pre className="whitespace-pre-wrap rounded-lg bg-muted/40 p-4 font-sans text-sm leading-relaxed">
              {s(r.body)}
            </pre>
          </>
        ) : null}
        {task === "seo_titles" ? (
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            {list(r.suggestions).map((x, n) => {
              const t = x as { title: string; reason: string };
              return (
                <li key={n}>
                  <span className="font-medium">{t.title}</span>{" "}
                  <span className="text-muted-foreground">
                    ({t.title.length} chars) {t.reason}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : null}
        {task === "meta_descriptions" ? (
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            {list(r.suggestions).map((x, n) => {
              const t = x as { text: string; reason?: string };
              return (
                <li key={n}>
                  {t.text} <span className="text-muted-foreground">({t.text.length} chars)</span>
                </li>
              );
            })}
          </ol>
        ) : null}
        {task === "social_captions"
          ? list(r.captions).map((x, n) => {
              const c = x as { text: string; hashtags: string[] };
              return (
                <div key={n} className="rounded-lg border border-border p-3 text-sm">
                  <p>{c.text}</p>
                  <p className="mt-1 text-muted-foreground">{c.hashtags.join(" ")}</p>
                </div>
              );
            })
          : null}
        {task === "hashtags" ? <p className="text-sm">{list(r.hashtags).join(" ")}</p> : null}
        {task === "repurpose" ? (
          <>
            <p className="font-medium">{s(r.title)}</p>
            <pre className="whitespace-pre-wrap rounded-lg bg-muted/40 p-4 font-sans text-sm">
              {s(r.body)}
            </pre>
            <p className="text-sm text-muted-foreground">{list(r.hashtags).join(" ")}</p>
          </>
        ) : null}
        {task === "seo_recommendations" ? (
          <>
            {list(r.recommendations).map((x, n) => {
              const t = x as {
                title: string;
                rationale: string;
                priority: string;
                effort: string;
                evidence: string[];
              };
              return (
                <div key={n} className="rounded-lg border border-border p-3 text-sm">
                  <p className="font-medium">
                    {t.title}{" "}
                    <span className="font-normal text-muted-foreground">
                      · {t.priority} priority · {t.effort} effort
                    </span>
                  </p>
                  <p className="mt-1">{t.rationale}</p>
                  <Bullets items={t.evidence} />
                </div>
              );
            })}
            <div>
              <p className="font-medium">Caveats</p>
              <Bullets items={list(r.caveats)} />
            </div>
          </>
        ) : null}
        {task === "report_summary" ? (
          <>
            <p className="text-sm leading-relaxed">{s(r.summary)}</p>
            <div>
              <p className="font-medium">Highlights</p>
              <Bullets items={list(r.highlights)} />
            </div>
            <div>
              <p className="font-medium">Risks</p>
              <Bullets items={list(r.risks)} />
            </div>
            <div>
              <p className="font-medium">Next steps</p>
              <Bullets items={list(r.nextSteps)} />
            </div>
            {list(r.figuresUsed).length ? (
              <p className="text-xs text-muted-foreground">
                Figures cited (synced readings, not verified):{" "}
                {list(r.figuresUsed)
                  .map((f) => `${(f as { label: string }).label} ${(f as { value: string }).value}`)
                  .join("; ")}
              </p>
            ) : null}
          </>
        ) : null}
      </section>
      {claims.length ? (
        <div className="rounded-lg border border-border p-3">
          <p className="text-sm font-medium">Check these before using the text</p>
          <Bullets items={claims} />
        </div>
      ) : null}
    </div>
  );
}
