import Link from "next/link";
import { Users } from "lucide-react";
import { getWorkload } from "@automation/db";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReassignDialog } from "@/components/tasks/reassign-dialog";
import { formatEffort } from "@/lib/format";
import { getScope } from "@/lib/scope";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Team workload" };

export default async function WorkloadPage() {
  const actor = await requireActor();
  const scope = await getScope(actor);
  const load = await getWorkload(actor, { clientId: scope.clientId, projectId: scope.projectId });
  const busiest = Math.max(1, ...load.rows.map((r) => r.open));
  const people = load.rows.map((r) => ({ userId: r.userId, name: r.name }));

  if (load.rows.length === 0 && load.unassigned.open === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No workload yet"
        description="When tasks are assigned, each person's open work, overdue tasks and estimated effort are shown here."
      />
    );
  }
  return (
    <>
      <p className="mb-4 max-w-prose text-sm text-muted-foreground">
        Open tasks are everything not completed or cancelled. Estimates are the effort planned on
        open tasks; logged time covers the last 7 days.
      </p>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <Table>
          <caption className="sr-only">Open work per team member</caption>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              {[
                "Person",
                "Open",
                "Overdue",
                "Due in 7 days",
                "In review",
                "Blocked",
                "Estimated",
                "Logged (7d)",
              ].map((h, i) => (
                <TableHead
                  key={h}
                  scope="col"
                  className={`h-11 px-4 text-xs font-medium uppercase tracking-wide text-muted-foreground ${i > 0 ? "text-right" : ""}`}
                >
                  {h}
                </TableHead>
              ))}
              {load.canReassign ? <TableHead className="w-24" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {load.rows.map((r) => (
              <TableRow key={r.userId}>
                <TableCell className="px-4 py-3">
                  <Link
                    href={`/tasks?assignee=${r.userId}`}
                    className="font-medium hover:underline"
                  >
                    {r.name}
                  </Link>
                  <span className="block text-xs text-muted-foreground">{r.email}</span>
                </TableCell>
                <TableCell className="px-4 py-3 text-right">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block"
                      aria-hidden
                    >
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${Math.round((r.open / busiest) * 100)}%` }}
                      />
                    </span>
                    <span className="tabular-nums">{r.open}</span>
                  </span>
                </TableCell>
                <TableCell className="px-4 py-3 text-right tabular-nums">
                  {r.overdue > 0 ? <Badge tone="destructive">{r.overdue}</Badge> : 0}
                </TableCell>
                <TableCell className="px-4 py-3 text-right tabular-nums">{r.dueThisWeek}</TableCell>
                <TableCell className="px-4 py-3 text-right tabular-nums">{r.inReview}</TableCell>
                <TableCell className="px-4 py-3 text-right tabular-nums">
                  {r.blocked > 0 ? <Badge tone="warning">{r.blocked}</Badge> : 0}
                </TableCell>
                <TableCell className="px-4 py-3 text-right tabular-nums">
                  {formatEffort(r.estimateMinutes)}
                </TableCell>
                <TableCell className="px-4 py-3 text-right tabular-nums">
                  {formatEffort(r.loggedMinutes7d)}
                </TableCell>
                {load.canReassign ? (
                  <TableCell className="px-2 py-3 text-right">
                    {r.open > 0 ? (
                      <ReassignDialog fromUserId={r.userId} fromName={r.name} people={people} />
                    ) : null}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
            <TableRow className="bg-muted/30">
              <TableCell className="px-4 py-3">
                <Link href="/tasks?assignee=none" className="font-medium hover:underline">
                  Unassigned
                </Link>
                <span className="block text-xs text-muted-foreground">
                  Waiting for someone to take them
                </span>
              </TableCell>
              <TableCell className="px-4 py-3 text-right tabular-nums">
                {load.unassigned.open}
              </TableCell>
              <TableCell className="px-4 py-3 text-right tabular-nums">
                {load.unassigned.overdue > 0 ? (
                  <Badge tone="destructive">{load.unassigned.overdue}</Badge>
                ) : (
                  0
                )}
              </TableCell>
              <TableCell colSpan={load.canReassign ? 6 : 5} />
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </>
  );
}
