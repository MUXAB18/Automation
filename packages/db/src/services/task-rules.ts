import type { Permission } from "../permissions";

/**
 * The task workflow as data: which status can follow which, who may make each move, and what the
 * move needs. Pure functions (no database), shared by the service that enforces it and by the UI that
 * only offers moves that will be accepted.
 *
 *   Backlog -> Assigned -> In progress -> Ready for review -> Approved -> Completed
 *   plus Changes requested (back from review), Blocked, and Cancelled.
 */

export const TASK_STATUSES = [
  "backlog",
  "assigned",
  "in_progress",
  "ready_for_review",
  "changes_requested",
  "blocked",
  "approved",
  "completed",
  "cancelled",
] as const;
export type TaskStatusName = (typeof TASK_STATUSES)[number];

export const STATUS_LABELS: Record<TaskStatusName, string> = {
  backlog: "Backlog",
  assigned: "Assigned",
  in_progress: "In progress",
  ready_for_review: "Ready for review",
  changes_requested: "Changes requested",
  blocked: "Blocked",
  approved: "Approved",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** Finished one way or the other. Everything else is "open" and can become overdue. */
export const CLOSED_STATUSES = [
  "completed",
  "cancelled",
] as const satisfies readonly TaskStatusName[];
export const OPEN_STATUSES = TASK_STATUSES.filter(
  (s) => !(CLOSED_STATUSES as readonly string[]).includes(s),
);

export const isClosed = (status: string) => (CLOSED_STATUSES as readonly string[]).includes(status);

/** A task is overdue when its due day has passed and it is not completed or cancelled. */
export function isOverdue(
  task: { dueAt: Date | null; status: string },
  now: Date = new Date(),
): boolean {
  return task.dueAt !== null && task.dueAt.getTime() < now.getTime() && !isClosed(task.status);
}

export const TRANSITIONS: Record<TaskStatusName, readonly TaskStatusName[]> = {
  backlog: ["assigned", "cancelled"],
  assigned: ["in_progress", "backlog", "blocked", "cancelled"],
  in_progress: ["ready_for_review", "assigned", "blocked", "cancelled"],
  ready_for_review: ["approved", "changes_requested", "in_progress", "cancelled"],
  changes_requested: ["in_progress", "blocked", "cancelled"],
  blocked: ["assigned", "in_progress", "cancelled"],
  approved: ["completed", "cancelled"],
  completed: [],
  cancelled: ["backlog"],
};

/** Who may make a move. */
export type Capability =
  | "work" // the assignee (with task.manage) or a manager (task.assign)
  | "assign" // task.assign
  | "review" // task.review, and not the person who did the work
  | "complete" // a manager, a reviewer, or the assignee
  | "cancel"; // a manager, or the person who created the task (with task.manage)

/** What a move needs from the person making it. */
export type Requirement = "note" | "evidence" | null;

type Rule = { capability: Capability; needs: Requirement; label: string };

const RULES: Partial<Record<TaskStatusName, Partial<Record<TaskStatusName, Rule>>>> = {
  backlog: {
    assigned: { capability: "assign", needs: null, label: "Mark as assigned" },
    cancelled: { capability: "cancel", needs: "note", label: "Cancel task" },
  },
  assigned: {
    in_progress: { capability: "work", needs: null, label: "Start work" },
    backlog: { capability: "assign", needs: null, label: "Move back to backlog" },
    blocked: { capability: "work", needs: "note", label: "Mark as blocked" },
    cancelled: { capability: "cancel", needs: "note", label: "Cancel task" },
  },
  in_progress: {
    ready_for_review: { capability: "work", needs: "evidence", label: "Submit for review" },
    assigned: { capability: "work", needs: null, label: "Pause work" },
    blocked: { capability: "work", needs: "note", label: "Mark as blocked" },
    cancelled: { capability: "cancel", needs: "note", label: "Cancel task" },
  },
  ready_for_review: {
    approved: { capability: "review", needs: null, label: "Approve" },
    changes_requested: { capability: "review", needs: "note", label: "Request changes" },
    in_progress: { capability: "work", needs: null, label: "Withdraw from review" },
    cancelled: { capability: "cancel", needs: "note", label: "Cancel task" },
  },
  changes_requested: {
    in_progress: { capability: "work", needs: null, label: "Resume work" },
    blocked: { capability: "work", needs: "note", label: "Mark as blocked" },
    cancelled: { capability: "cancel", needs: "note", label: "Cancel task" },
  },
  blocked: {
    assigned: { capability: "work", needs: null, label: "Unblock (not started)" },
    in_progress: { capability: "work", needs: null, label: "Unblock and continue" },
    cancelled: { capability: "cancel", needs: "note", label: "Cancel task" },
  },
  approved: {
    completed: { capability: "complete", needs: null, label: "Mark as completed" },
    cancelled: { capability: "cancel", needs: "note", label: "Cancel task" },
  },
  cancelled: {
    backlog: { capability: "assign", needs: null, label: "Reopen" },
  },
};

export function transitionRule(from: TaskStatusName, to: TaskStatusName): Rule | undefined {
  return RULES[from]?.[to];
}

export const canTransition = (from: TaskStatusName, to: TaskStatusName) =>
  TRANSITIONS[from].includes(to);

/** The facts about a task and a person that decide what they may do with it. */
export type ActorTaskContext = {
  userId: string;
  permissions: ReadonlySet<Permission>;
  assigneeId: string | null;
  reporterId: string | null;
};

export function hasCapability(capability: Capability, c: ActorTaskContext): boolean {
  const has = (p: Permission) => c.permissions.has(p);
  const isAssignee = c.assigneeId === c.userId;
  switch (capability) {
    case "assign":
      return has("task.assign");
    case "work":
      return has("task.assign") || (has("task.manage") && isAssignee);
    case "review":
      // Nobody approves their own work, whatever their permissions.
      return has("task.review") && !isAssignee;
    case "complete":
      return has("task.assign") || has("task.review") || (has("task.manage") && isAssignee);
    case "cancel":
      return has("task.assign") || (has("task.manage") && c.reporterId === c.userId);
  }
}

export type AllowedMove = {
  to: TaskStatusName;
  label: string;
  needs: Requirement;
  disabledReason?: string;
};

/**
 * The moves a person can make right now, for the buttons on a task. `openDependencies` are tasks it
 * waits for; they block starting and completing. A move that is permitted but not possible yet is
 * returned with `disabledReason` so the UI can explain instead of hiding it.
 */
export function allowedMoves(
  task: { status: TaskStatusName; openDependencies: number; hasAssignee: boolean },
  actor: ActorTaskContext,
): AllowedMove[] {
  const moves: AllowedMove[] = [];
  for (const to of TRANSITIONS[task.status]) {
    const rule = transitionRule(task.status, to);
    if (!rule || !hasCapability(rule.capability, actor)) continue;
    let disabledReason: string | undefined;
    if (to === "assigned" && task.status === "backlog" && !task.hasAssignee)
      disabledReason = "Assign someone first";
    if (
      (to === "in_progress" || to === "completed") &&
      task.openDependencies > 0 &&
      task.status !== "blocked" &&
      !(task.status === "ready_for_review")
    ) {
      disabledReason = `Waiting for ${task.openDependencies} other task${task.openDependencies > 1 ? "s" : ""}`;
    }
    moves.push({
      to,
      label: rule.label,
      needs: rule.needs,
      ...(disabledReason ? { disabledReason } : {}),
    });
  }
  return moves;
}
