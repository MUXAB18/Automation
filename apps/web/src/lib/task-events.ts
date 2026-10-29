import { STATUS_LABELS, type TaskStatusName } from "@automation/db";

type EventLike = { type: string; fromValue: unknown; toValue: unknown };

const status = (v: unknown): string => {
  const s =
    typeof v === "object" && v !== null && "status" in v ? (v as { status: unknown }).status : v;
  return typeof s === "string" && s in STATUS_LABELS
    ? STATUS_LABELS[s as TaskStatusName]
    : String(s ?? "—");
};
const noteOf = (v: unknown) =>
  typeof v === "object" &&
  v !== null &&
  "note" in v &&
  typeof (v as { note: unknown }).note === "string"
    ? (v as { note: string }).note
    : undefined;
const name = (names: Record<string, string>, v: unknown) =>
  typeof v === "string" ? (names[v] ?? "someone") : "nobody";

/** One readable line (and an optional detail) for an entry in a task's history. */
export function describeEvent(
  e: EventLike,
  names: Record<string, string>,
): { text: string; detail?: string } {
  switch (e.type) {
    case "created": {
      const via =
        typeof e.toValue === "object" && e.toValue !== null && "automation" in e.toValue
          ? " from an automation"
          : "";
      return { text: `created the task${via}` };
    }
    case "status_changed":
      return {
        text: `moved the task from ${status(e.fromValue)} to ${status(e.toValue)}`,
        detail: noteOf(e.toValue),
      };
    case "assigned":
      return { text: `assigned the task to ${name(names, e.toValue)}` };
    case "reassigned":
      return {
        text: `reassigned the task from ${name(names, e.fromValue)} to ${name(names, e.toValue)}`,
      };
    case "unassigned":
      return { text: `took the task off ${name(names, e.fromValue)}` };
    case "priority_changed":
      return { text: `changed the priority from ${String(e.fromValue)} to ${String(e.toValue)}` };
    case "due_date_changed":
      return { text: e.toValue ? "changed the due date" : "removed the due date" };
    case "evidence_submitted":
      return { text: "submitted evidence for review", detail: noteOf(e.toValue) };
    case "comment_added":
      return { text: "added a comment" };
    case "attachment_added":
      return {
        text: `attached ${typeof e.toValue === "object" && e.toValue !== null && "fileName" in e.toValue ? String((e.toValue as { fileName: unknown }).fileName) : "a file"}`,
      };
    case "dependency_added":
      return {
        text: `made the task wait for “${typeof e.toValue === "object" && e.toValue !== null && "title" in e.toValue ? String((e.toValue as { title: unknown }).title) : "another task"}”`,
      };
    case "dependency_removed":
      return { text: "removed a dependency" };
    case "time_logged": {
      const minutes =
        typeof e.toValue === "object" && e.toValue !== null && "minutes" in e.toValue
          ? Number((e.toValue as { minutes: unknown }).minutes)
          : 0;
      return {
        text: `logged ${minutes} minute${minutes === 1 ? "" : "s"}`,
        detail: noteOf(e.toValue),
      };
    }
    case "linked":
      return { text: "changed the linked content" };
    case "updated": {
      const keys =
        typeof e.toValue === "object" && e.toValue !== null ? Object.keys(e.toValue) : [];
      return {
        text: keys.length
          ? `edited ${keys.map((k) => k.replace(/([A-Z])/g, " $1").toLowerCase()).join(", ")}`
          : "edited the task",
      };
    }
    case "archived":
      return { text: "archived the task" };
    default:
      return { text: e.type.replace(/_/g, " ") };
  }
}
