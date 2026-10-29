import { describe, expect, it } from "vitest";
import type { Permission } from "../permissions";
import {
  CLOSED_STATUSES,
  OPEN_STATUSES,
  TASK_STATUSES,
  TRANSITIONS,
  allowedMoves,
  canTransition,
  hasCapability,
  isOverdue,
  transitionRule,
  type ActorTaskContext,
  type TaskStatusName,
} from "./task-rules";

const who = (
  permissions: Permission[],
  over: Partial<ActorTaskContext> = {},
): ActorTaskContext => ({
  userId: "me",
  permissions: new Set(permissions),
  assigneeId: null,
  reporterId: null,
  ...over,
});

describe("workflow definition", () => {
  it("covers all nine statuses", () => {
    expect([...TASK_STATUSES].sort()).toEqual([
      "approved",
      "assigned",
      "backlog",
      "blocked",
      "cancelled",
      "changes_requested",
      "completed",
      "in_progress",
      "ready_for_review",
    ]);
  });

  it("has a rule (who, what it needs) for every allowed move and no rule for any other", () => {
    for (const from of TASK_STATUSES) {
      for (const to of TASK_STATUSES) {
        expect(Boolean(transitionRule(from, to)), `${from} -> ${to}`).toBe(canTransition(from, to));
      }
    }
  });

  it("follows Backlog -> Assigned -> In progress -> Ready for review -> Approved -> Completed", () => {
    const path: TaskStatusName[] = [
      "backlog",
      "assigned",
      "in_progress",
      "ready_for_review",
      "approved",
      "completed",
    ];
    for (let i = 0; i < path.length - 1; i++)
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
  });

  it("sends reviewed work back through Changes requested, never straight to Completed", () => {
    expect(canTransition("ready_for_review", "changes_requested")).toBe(true);
    expect(canTransition("changes_requested", "in_progress")).toBe(true);
    expect(canTransition("ready_for_review", "completed")).toBe(false);
    expect(canTransition("in_progress", "approved")).toBe(false);
    expect(canTransition("in_progress", "completed")).toBe(false);
    expect(canTransition("backlog", "in_progress")).toBe(false);
  });

  it("makes Completed final, lets Cancelled be reopened, and allows cancelling any unfinished task", () => {
    expect(TRANSITIONS.completed).toEqual([]);
    expect(TRANSITIONS.cancelled).toEqual(["backlog"]);
    for (const s of OPEN_STATUSES) expect(canTransition(s, "cancelled"), s).toBe(true);
    expect(CLOSED_STATUSES).toEqual(["completed", "cancelled"]);
  });

  it("asks for a reason where a decision needs explaining, and for evidence to go to review", () => {
    expect(transitionRule("in_progress", "ready_for_review")?.needs).toBe("evidence");
    for (const [from, to] of [
      ["ready_for_review", "changes_requested"],
      ["assigned", "blocked"],
      ["in_progress", "cancelled"],
    ] as const) {
      expect(transitionRule(from, to)?.needs, `${from} -> ${to}`).toBe("note");
    }
    expect(transitionRule("ready_for_review", "approved")?.needs).toBeNull();
  });
});

describe("overdue", () => {
  const now = new Date("2026-05-10T12:00:00Z");
  const past = new Date("2026-05-10T11:59:59Z");
  const future = new Date("2026-05-10T12:00:01Z");

  it("is true for an unfinished task whose due time has passed", () => {
    for (const status of OPEN_STATUSES)
      expect(isOverdue({ dueAt: past, status }, now), status).toBe(true);
  });

  it("is false once completed or cancelled, however late", () => {
    expect(isOverdue({ dueAt: new Date("2020-01-01"), status: "completed" }, now)).toBe(false);
    expect(isOverdue({ dueAt: new Date("2020-01-01"), status: "cancelled" }, now)).toBe(false);
  });

  it("is false with no due date, a future due date, or exactly at the due time", () => {
    expect(isOverdue({ dueAt: null, status: "in_progress" }, now)).toBe(false);
    expect(isOverdue({ dueAt: future, status: "in_progress" }, now)).toBe(false);
    expect(isOverdue({ dueAt: now, status: "in_progress" }, now)).toBe(false);
  });
});

describe("who may do what", () => {
  it("lets the assignee work, but only with task.manage", () => {
    expect(hasCapability("work", who(["task.manage"], { assigneeId: "me" }))).toBe(true);
    expect(hasCapability("work", who(["task.manage"], { assigneeId: "someone" }))).toBe(false);
    expect(hasCapability("work", who(["task.view"], { assigneeId: "me" }))).toBe(false);
    expect(hasCapability("work", who(["task.assign"], { assigneeId: "someone" }))).toBe(true);
  });

  it("lets only reviewers review, and never their own work", () => {
    expect(hasCapability("review", who(["task.review"], { assigneeId: "someone" }))).toBe(true);
    expect(hasCapability("review", who(["task.review", "task.assign"], { assigneeId: "me" }))).toBe(
      false,
    );
    expect(
      hasCapability("review", who(["task.manage", "task.assign"], { assigneeId: "someone" })),
    ).toBe(false);
  });

  it("lets the creator cancel their own task but not other people's", () => {
    expect(hasCapability("cancel", who(["task.manage"], { reporterId: "me" }))).toBe(true);
    expect(hasCapability("cancel", who(["task.manage"], { reporterId: "other" }))).toBe(false);
    expect(hasCapability("cancel", who(["task.assign"]))).toBe(true);
  });

  it("lets the assignee, a manager or a reviewer complete an approved task", () => {
    expect(hasCapability("complete", who(["task.manage"], { assigneeId: "me" }))).toBe(true);
    expect(hasCapability("complete", who(["task.review"]))).toBe(true);
    expect(hasCapability("complete", who(["task.manage"], { assigneeId: "other" }))).toBe(false);
  });
});

describe("moves offered to a person", () => {
  const task = (
    status: TaskStatusName,
    extra: Partial<{ openDependencies: number; hasAssignee: boolean }> = {},
  ) => ({ status, openDependencies: 0, hasAssignee: true, ...extra });

  it("offers an assignee the next steps of their own work", () => {
    const moves = allowedMoves(task("in_progress"), who(["task.manage"], { assigneeId: "me" }));
    expect(moves.map((m) => m.to).sort()).toEqual(["assigned", "blocked", "ready_for_review"]);
    expect(moves.find((m) => m.to === "ready_for_review")?.needs).toBe("evidence");
  });

  it("offers a reviewer approve and request changes, and nothing to the author", () => {
    expect(
      allowedMoves(task("ready_for_review"), who(["task.review"], { assigneeId: "other" }))
        .map((m) => m.to)
        .sort(),
    ).toEqual(["approved", "changes_requested"]);
    expect(
      allowedMoves(task("ready_for_review"), who(["task.review"], { assigneeId: "me" })),
    ).toEqual([]);
  });

  it("explains why a move is not possible yet instead of hiding it", () => {
    const moves = allowedMoves(
      task("assigned", { openDependencies: 2 }),
      who(["task.manage"], { assigneeId: "me" }),
    );
    expect(moves.find((m) => m.to === "in_progress")?.disabledReason).toMatch(
      /Waiting for 2 other tasks/,
    );
    const backlog = allowedMoves(task("backlog", { hasAssignee: false }), who(["task.assign"]));
    expect(backlog.find((m) => m.to === "assigned")?.disabledReason).toMatch(
      /Assign someone first/,
    );
  });

  it("offers nothing on a completed task and a readonly viewer nothing at all", () => {
    expect(allowedMoves(task("completed"), who(["task.assign", "task.review"]))).toEqual([]);
    for (const status of TASK_STATUSES)
      expect(allowedMoves(task(status), who(["task.view"])), status).toEqual([]);
  });
});
