import { Badge } from "@/components/ui/badge";

type Tone = "neutral" | "success" | "warning" | "info" | "destructive" | "primary";

/** One place that decides the colour of every status in the app. Unknown values render neutral. */
const TONES: Record<string, Record<string, Tone>> = {
  client: { active: "success", paused: "warning", archived: "neutral" },
  project: { active: "success", paused: "warning", completed: "primary", archived: "neutral" },
  task: {
    backlog: "neutral",
    assigned: "info",
    in_progress: "info",
    ready_for_review: "primary",
    changes_requested: "warning",
    blocked: "destructive",
    approved: "success",
    completed: "success",
    cancelled: "neutral",
  },
  priority: { low: "neutral", medium: "info", high: "warning", urgent: "destructive" },
  content: {
    idea: "neutral",
    brief: "neutral",
    client_approval: "primary",
    rejected: "destructive",
    cancelled: "neutral",
    draft: "neutral",
    in_review: "primary",
    changes_requested: "warning",
    approved: "success",
    scheduled: "info",
    publishing: "info",
    published: "success",
    failed: "destructive",
    archived: "neutral",
  },
  approval: {
    pending: "warning",
    approved: "success",
    rejected: "destructive",
    changes_requested: "warning",
    cancelled: "neutral",
    expired: "neutral",
  },
  severity: {
    info: "neutral",
    low: "neutral",
    medium: "warning",
    high: "destructive",
    critical: "destructive",
  },
  issue: {
    open: "warning",
    acknowledged: "info",
    in_progress: "info",
    fixed: "success",
    ignored: "neutral",
    reopened: "destructive",
  },
  integration: {
    active: "success",
    needs_reauth: "warning",
    error: "destructive",
    disconnected: "neutral",
  },
  run: {
    queued: "neutral",
    running: "info",
    succeeded: "success",
    partial: "warning",
    failed: "destructive",
    cancelled: "neutral",
    awaiting_approval: "warning",
    skipped: "neutral",
  },
  delivery: { pending: "neutral", sending: "info", needs_review: "warning", sent: "success", delivered: "success", bounced: "destructive", failed: "destructive", cancelled: "neutral" },
  rule: { draft: "neutral", active: "success", paused: "warning", archived: "neutral" },
  report: {
    draft: "neutral",
    generating: "info",
    ready: "primary",
    approved: "success",
    delivered: "success",
    failed: "destructive",
    archived: "neutral",
  },
  publishing: {
    needs_review: "warning",
    queued: "neutral",
    scheduled: "info",
    publishing: "info",
    succeeded: "success",
    failed: "destructive",
    cancelled: "neutral",
  },
  post: { live: "success", removed: "neutral", hidden: "warning" },
  audit: {
    queued: "neutral",
    running: "info",
    completed: "success",
    failed: "destructive",
    cancelled: "neutral",
  },
};

export type StatusKind = keyof typeof TONES;

const label = (value: string) => value.replace(/_/g, " ");

export function StatusBadge({ kind = "client", status }: { kind?: StatusKind; status: string }) {
  return <Badge tone={TONES[kind]?.[status] ?? "neutral"}>{label(status)}</Badge>;
}
