import { describe, expect, it } from "vitest";
import { parseRulePayload } from "@automation/db";
import { ruleInput } from "./automation-input";

function form(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("ruleInput", () => {
  const base = {
    name: "Traffic watch",
    kind: "organic_traffic_drop",
    severity: "high",
    intervalMinutes: "720",
    "config.metric": "gsc_clicks",
    "config.windowDays": "14",
    "config.dropPercent": "30",
    "config.minBaseline": "50",
    "config.maxStaleDays": "4",
    "task.title": "Investigate traffic drop",
    "task.labels": "automation, traffic",
    "assignment.mode": "role",
    "assignment.roleKey": "seo_manager",
    "notify.enabled": "on",
    "notify.assignee": "on",
  };

  it("builds a payload the rule schema accepts", () => {
    const { payload } = ruleInput(form(base));
    const parsed = parseRulePayload(payload);
    expect(parsed.config).toMatchObject({ metric: "gsc_clicks", windowDays: 14, dropPercent: 30 });
    expect(parsed.taskTemplate.labels).toEqual(["automation", "traffic"]);
    expect(parsed.notifyPolicy).toMatchObject({ enabled: true, assignee: true, managers: false });
  });

  it("reads unticked checkboxes as false, never as true", () => {
    const { payload } = ruleInput(form({ ...base, "notify.enabled": "" }));
    delete (payload.notifyPolicy as Record<string, unknown>).nothing;
    const parsed = parseRulePayload({
      ...payload,
      notifyPolicy: { ...payload.notifyPolicy, enabled: false },
    });
    expect(parsed.notifyPolicy.enabled).toBe(false);
    expect(ruleInput(form(base)).payload.duePolicy).toMatchObject({ businessDays: false });
  });

  it("does not enable a new rule unless asked", () => {
    expect(ruleInput(form(base)).enabled).toBe(false);
    expect(ruleInput(form({ ...base, enabled: "on" })).enabled).toBe(true);
  });
});
