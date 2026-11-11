import { z } from "zod";
import { dateInTimeZone } from "../dates";

/**
 * Configuration of the monitoring rules. Every rule type has its own validated `config`; the policies
 * (assignment, task template, due date, notification, cooldown) share one shape. Nothing here is
 * code per client: all of it is data on the rule (CLAUDE.md rule 3).
 */

export const RULE_KINDS = [
  "keyword_rank_drop",
  "critical_audit_issue",
  "page_needs_optimization",
  "organic_traffic_drop",
  "content_deadline_approaching",
  "task_overdue",
  "integration_failing",
] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export const KIND_LABEL: Record<RuleKind, string> = {
  keyword_rank_drop: "Important keyword ranking drop",
  critical_audit_issue: "Critical site audit issue",
  page_needs_optimization: "Important page needs optimization",
  organic_traffic_drop: "Organic search traffic drop",
  content_deadline_approaching: "Content deadline approaching",
  task_overdue: "Task overdue",
  integration_failing: "Integration repeatedly failing",
};

export const KIND_DESCRIPTION: Record<RuleKind, string> = {
  keyword_rank_drop:
    "Keywords tagged as important that lose positions (or stop ranking) compared with a week earlier. Uses ranking history.",
  critical_audit_issue:
    "Open site audit issues at or above a severity. Needs a recent completed audit.",
  page_needs_optimization:
    "Pages with many Search Console impressions that sit just off the first results, with a low click-through rate.",
  organic_traffic_drop:
    "Organic search traffic (Google Analytics organic sessions, or Search Console clicks) falling against the previous period.",
  content_deadline_approaching: "Content scheduled soon that has not been approved yet.",
  task_overdue:
    "Open tasks past their due date. Notifies only: it never creates tasks, so tasks cannot trigger more tasks.",
  integration_failing:
    "Connected accounts whose last several syncs all failed, or that need reconnecting.",
};

/** Rules of this kind only notify; they never create a task (loop prevention). */
export const NOTIFY_ONLY_KINDS: readonly RuleKind[] = ["task_overdue"];

const SEVERITY = z.enum(["info", "low", "medium", "high", "critical"]);
export const SEVERITIES = SEVERITY.options;
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

export const configSchemas = {
  keyword_rank_drop: z.object({
    importantTag: z.string().trim().min(1).max(60).default("important"),
    positionDrop: int(1, 100).default(5),
    compareDays: int(1, 60).default(7),
    maxStaleDays: int(1, 30).default(3),
    includeLostRankings: z.coerce.boolean().default(true),
  }),
  critical_audit_issue: z.object({
    minSeverity: z.enum(["low", "medium", "high", "critical"]).default("high"),
    maxAuditAgeDays: int(1, 90).default(14),
  }),
  page_needs_optimization: z.object({
    windowDays: int(7, 90).default(28),
    minImpressions: int(10, 10_000_000).default(500),
    minPosition: z.coerce.number().min(1).max(100).default(4),
    maxPosition: z.coerce.number().min(1).max(100).default(20),
    maxCtr: z.coerce.number().min(0).max(1).default(0.03),
    maxStaleDays: int(1, 30).default(5),
    maxFindings: int(1, 100).default(10),
  }),
  organic_traffic_drop: z.object({
    metric: z.enum(["ga4_organic", "gsc_clicks"]).default("ga4_organic"),
    windowDays: int(3, 60).default(7),
    dropPercent: int(1, 100).default(25),
    minBaseline: int(1, 10_000_000).default(100),
    maxStaleDays: int(1, 30).default(4),
  }),
  content_deadline_approaching: z.object({
    hoursAhead: int(1, 24 * 30).default(48),
    includeMissed: z.coerce.boolean().default(true),
  }),
  task_overdue: z.object({
    graceHours: int(0, 24 * 30).default(0),
    escalateAfterDays: int(1, 60).default(3),
  }),
  integration_failing: z.object({
    consecutiveFailures: int(2, 20).default(3),
    includeNeedsReauth: z.coerce.boolean().default(true),
  }),
} satisfies Record<RuleKind, z.ZodType>;

export type ConfigOf<K extends RuleKind> = z.output<(typeof configSchemas)[K]>;

// ---- Shared policies ----------------------------------------------------------------------------------------

export const AUTOMATION_ROLE_KEYS = [
  "agency_admin",
  "seo_manager",
  "seo_specialist",
  "content_writer",
  "social_media_manager",
  "reviewer",
] as const;

export const assignmentSchema = z.object({
  /** user: a named person. role: someone holding a role. entity_owner: whoever owns the thing (falls back to role). review_queue: unassigned, reviewers are told. */
  mode: z.enum(["user", "role", "entity_owner", "review_queue"]).default("role"),
  userId: z.string().min(1).optional(),
  roleKey: z.enum(AUTOMATION_ROLE_KEYS).default("seo_specialist"),
  strategy: z.enum(["least_loaded", "first"]).default("least_loaded"),
});

export const taskTemplateSchema = z.object({
  /** false = record and notify only. Always false for notify-only rule types. */
  createTask: z.coerce.boolean().default(true),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).default(""),
  acceptanceCriteria: z.string().trim().max(4000).default(""),
  type: z.enum(["general", "seo_fix", "content", "social", "reporting"]).default("seo_fix"),
  labels: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  estimateMinutes: z.coerce
    .number()
    .int()
    .min(5)
    .max(60 * 80)
    .optional(),
});

export const duePolicySchema = z.object({
  mode: z.enum(["days", "by_severity"]).default("by_severity"),
  days: int(0, 365).default(7),
  businessDays: z.coerce.boolean().default(true),
});

export const notifyPolicySchema = z.object({
  enabled: z.coerce.boolean().default(true),
  assignee: z.coerce.boolean().default(true),
  /** People who can assign tasks on the client (managers). */
  managers: z.coerce.boolean().default(false),
  /** People who can review tasks: told when work lands in the review queue. */
  reviewers: z.coerce.boolean().default(false),
  /** Tell people again about a still-open finding after this many hours. 0 = never. */
  reNotifyHours: int(0, 24 * 90).default(0),
});

export const cooldownSchema = z.object({
  /** After a finding's task is closed, wait this long before a new one is created for the same finding. */
  hours: int(0, 24 * 365).default(72),
  maxTasksPerRun: int(1, 100).default(10),
  /** Stop creating tasks while the client already has this many open automation tasks. */
  maxOpenTasks: int(1, 1000).default(50),
});

export type Assignment = z.output<typeof assignmentSchema>;
export type TaskTemplate = z.output<typeof taskTemplateSchema>;
export type AutomationDuePolicy = z.output<typeof duePolicySchema>;
export type NotifyPolicy = z.output<typeof notifyPolicySchema>;
export type Cooldown = z.output<typeof cooldownSchema>;

export const rulePayloadSchema = z
  .object({
    name: z.string().trim().min(3, "Give the rule a name").max(120),
    description: z.string().trim().max(1000).optional(),
    kind: z.enum(RULE_KINDS),
    severity: SEVERITY.default("medium"),
    intervalMinutes: int(5, 10_080).default(60),
    config: z.record(z.string(), z.unknown()).default({}),
    assignment: assignmentSchema.default(() => assignmentSchema.parse({})),
    taskTemplate: taskTemplateSchema,
    duePolicy: duePolicySchema.default(() => duePolicySchema.parse({})),
    notifyPolicy: notifyPolicySchema.default(() => notifyPolicySchema.parse({})),
    cooldown: cooldownSchema.default(() => cooldownSchema.parse({})),
  })
  .superRefine((v, ctx) => {
    const parsed = configSchemas[v.kind].safeParse(v.config);
    if (!parsed.success)
      for (const i of parsed.error.issues)
        ctx.addIssue({ code: "custom", path: ["config", ...i.path], message: i.message });
    if (v.assignment.mode === "user" && !v.assignment.userId)
      ctx.addIssue({ code: "custom", path: ["assignment", "userId"], message: "Choose a person" });
    if (
      v.kind === "page_needs_optimization" &&
      parsed.success &&
      (parsed.data as ConfigOf<"page_needs_optimization">).minPosition >
        (parsed.data as ConfigOf<"page_needs_optimization">).maxPosition
    )
      ctx.addIssue({
        code: "custom",
        path: ["config", "minPosition"],
        message: "The first position must not be below the last",
      });
  });
export type RulePayload = z.input<typeof rulePayloadSchema>;
export type ParsedRulePayload = z.output<typeof rulePayloadSchema>;

/** Validate and normalise a rule's JSON. Throws ZodError with field paths. */
export function parseRulePayload(input: unknown): ParsedRulePayload {
  const parsed = rulePayloadSchema.parse(input);
  const config = configSchemas[parsed.kind].parse(parsed.config);
  return {
    ...parsed,
    config,
    taskTemplate: NOTIFY_ONLY_KINDS.includes(parsed.kind)
      ? { ...parsed.taskTemplate, createTask: false }
      : parsed.taskTemplate,
  };
}

// ---- The recommended rules ------------------------------------------------------------------------------------

const base = (
  kind: RuleKind,
  name: string,
  severity: ParsedRulePayload["severity"],
  t: Partial<TaskTemplate> & { title: string },
  over: Partial<RulePayload> = {},
): RulePayload => ({
  name,
  kind,
  severity,
  intervalMinutes: 60,
  config: {},
  assignment: { mode: "role", roleKey: "seo_specialist", strategy: "least_loaded" },
  taskTemplate: {
    createTask: true,
    description: "",
    acceptanceCriteria: "",
    type: "seo_fix",
    labels: ["automation"],
    ...t,
  },
  duePolicy: { mode: "by_severity", days: 7, businessDays: true },
  notifyPolicy: {
    enabled: true,
    assignee: true,
    managers: false,
    reviewers: false,
    reNotifyHours: 0,
  },
  cooldown: { hours: 72, maxTasksPerRun: 10, maxOpenTasks: 50 },
  ...over,
});

/** The seven starting rules. Created paused so nothing happens until someone reviews and enables them. */
export const RECOMMENDED_RULES: RulePayload[] = [
  base(
    "keyword_rank_drop",
    "Important keyword ranking drop",
    "high",
    {
      title: "Investigate ranking drop for '{{keyword}}' ({{from}} to {{to}})",
      description:
        "The important keyword '{{keyword}}' moved from position {{from}} to {{to}} ({{drop}} places) between {{baselineDay}} and {{latestDay}}.\nRanking page: {{url}}",
      acceptanceCriteria:
        "The cause of the drop is identified and written in a comment.\nA fix or a decision not to act is recorded.\nThe keyword is re-checked after the change.",
      labels: ["automation", "ranking"],
    },
    {
      config: {
        importantTag: "important",
        positionDrop: 5,
        compareDays: 7,
        maxStaleDays: 3,
        includeLostRankings: true,
      },
    },
  ),
  base(
    "critical_audit_issue",
    "Critical site audit issue",
    "high",
    {
      title: "Fix site audit issue: {{issue}}",
      description:
        "The site audit reports '{{issue}}' ({{section}}), affecting {{pages}} page(s).\nExample pages:\n{{examples}}",
      acceptanceCriteria:
        "The issue is fixed on the affected pages.\nThe next site audit no longer reports it.",
      labels: ["automation", "audit"],
    },
    {
      config: { minSeverity: "high", maxAuditAgeDays: 14 },
      intervalMinutes: 240,
      assignment: { mode: "role", roleKey: "seo_specialist", strategy: "least_loaded" },
    },
  ),
  base(
    "page_needs_optimization",
    "Important page needs optimization",
    "medium",
    {
      title: "Optimize page {{page}} (position {{position}}, CTR {{ctr}})",
      description:
        "{{page}} earned {{impressions}} impressions and {{clicks}} clicks over {{windowDays}} days at an average position of {{position}} (CTR {{ctr}}).\nIt is close to the first results but few people click.",
      acceptanceCriteria:
        "Title and meta description are rewritten for the page's main query.\nContent is reviewed for the search intent.\nChanges are approved before anything is published.",
      type: "content",
      labels: ["automation", "optimization"],
    },
    {
      config: {
        windowDays: 28,
        minImpressions: 500,
        minPosition: 4,
        maxPosition: 20,
        maxCtr: 0.03,
        maxStaleDays: 5,
        maxFindings: 10,
      },
      intervalMinutes: 1440,
      assignment: { mode: "role", roleKey: "content_writer", strategy: "least_loaded" },
    },
  ),
  base(
    "organic_traffic_drop",
    "Organic search traffic drop",
    "high",
    {
      title: "Organic traffic down {{dropPercent}}% ({{source}})",
      description:
        "{{metricLabel}} fell from {{previous}} to {{current}} ({{dropPercent}}%) comparing {{currentPeriod}} with {{previousPeriod}}.",
      acceptanceCriteria:
        "The likely cause (ranking loss, tracking issue, seasonality, outage) is identified.\nA plan or a decision not to act is recorded.",
      labels: ["automation", "traffic"],
    },
    {
      config: {
        metric: "ga4_organic",
        windowDays: 7,
        dropPercent: 25,
        minBaseline: 100,
        maxStaleDays: 4,
      },
      intervalMinutes: 720,
      assignment: { mode: "role", roleKey: "seo_manager", strategy: "least_loaded" },
      notifyPolicy: {
        enabled: true,
        assignee: true,
        managers: true,
        reviewers: false,
        reNotifyHours: 0,
      },
    },
  ),
  base(
    "content_deadline_approaching",
    "Content deadline approaching",
    "medium",
    {
      title: "Content due {{when}}: {{content}}",
      description:
        "'{{content}}' ({{channel}}) is scheduled for {{scheduledFor}} but is still {{status}}.",
      acceptanceCriteria:
        "The content is finished and approved before it is due, or its date is moved.",
      type: "content",
      labels: ["automation", "content"],
    },
    {
      config: { hoursAhead: 48, includeMissed: true },
      intervalMinutes: 120,
      assignment: { mode: "entity_owner", roleKey: "content_writer", strategy: "least_loaded" },
    },
  ),
  base(
    "task_overdue",
    "Task overdue",
    "medium",
    { title: "Task overdue: {{task}}", createTask: false },
    {
      config: { graceHours: 0, escalateAfterDays: 3 },
      intervalMinutes: 240,
      notifyPolicy: {
        enabled: true,
        assignee: true,
        managers: true,
        reviewers: false,
        reNotifyHours: 72,
      },
    },
  ),
  base(
    "integration_failing",
    "Integration repeatedly failing",
    "high",
    {
      title: "Fix failing integration: {{integration}}",
      description: "{{integration}} failed its last {{failures}} syncs.\nRecent errors: {{errors}}",
      acceptanceCriteria:
        "The account is reconnected or the cause is fixed.\nA sync finishes successfully.",
      type: "general",
      labels: ["automation", "integration"],
    },
    {
      config: { consecutiveFailures: 3, includeNeedsReauth: true },
      intervalMinutes: 60,
      assignment: { mode: "role", roleKey: "seo_manager", strategy: "least_loaded" },
      notifyPolicy: {
        enabled: true,
        assignee: true,
        managers: true,
        reviewers: false,
        reNotifyHours: 0,
      },
    },
  ),
];

// ---- Templates and due dates ------------------------------------------------------------------------------------

/** Replace {{name}} with values; missing values become empty. Output is length-limited. */
export function renderTemplate(
  text: string,
  vars: Record<string, string | number | null | undefined>,
  max = 4000,
): string {
  return text
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => String(vars[k] ?? ""))
    .slice(0, max)
    .trim();
}

export const PRIORITY_BY_SEVERITY = {
  info: "low",
  low: "low",
  medium: "medium",
  high: "high",
  critical: "urgent",
} as const;
const DAYS_BY_SEVERITY = { info: 14, low: 14, medium: 7, high: 3, critical: 1 } as const;

/** The due DATE (YYYY-MM-DD in the client's time zone) a policy gives for a finding detected `now`. */
export function computeDueDate(
  policy: AutomationDuePolicy,
  severity: keyof typeof DAYS_BY_SEVERITY,
  now: Date,
  timeZone: string,
): string {
  const days = policy.mode === "days" ? policy.days : DAYS_BY_SEVERITY[severity];
  const [y, m, d] = dateInTimeZone(now, timeZone).split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const cursor = new Date(Date.UTC(y, m - 1, d));
  let left = days;
  while (left > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const dow = cursor.getUTCDay();
    if (policy.businessDays && (dow === 0 || dow === 6)) continue;
    left--;
  }
  return cursor.toISOString().slice(0, 10);
}
