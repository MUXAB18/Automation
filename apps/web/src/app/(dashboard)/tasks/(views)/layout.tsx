import Link from "next/link";
import { getTaskCounts } from "@automation/db";
import { PageHeader } from "@/components/page-header";
import { ScopeBadge } from "@/components/scope-badge";
import { TabsNav } from "@/components/tabs-nav";
import { Button } from "@/components/ui/button";
import { getScope } from "@/lib/scope";
import { requireSection } from "@/lib/sections";
import { requireActor } from "@/lib/session";

/** Header and view tabs shared by every task list: All, Mine, Board, Calendar, Overdue, Workload, Review. */
export default async function TasksViewsLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  await requireSection(actor, "tasks");
  const scope = await getScope(actor);
  const counts = await getTaskCounts(actor, {
    clientId: scope.clientId,
    projectId: scope.projectId,
  });
  return (
    <>
      <PageHeader
        title="Tasks"
        description="Everything that needs doing, who is doing it, and what is waiting for a decision."
        breadcrumbs={[{ label: "Tasks" }]}
        badges={<ScopeBadge scope={scope} />}
        actions={
          counts.canCreate ? (
            <Button asChild>
              <Link href={`/tasks/new${scope.clientId ? `?client=${scope.clientId}` : ""}`}>
                New task
              </Link>
            </Button>
          ) : null
        }
      />
      <TabsNav
        label="Task views"
        tabs={[
          { href: "/tasks", label: "All tasks", exact: true },
          { href: "/tasks/mine", label: "My tasks", count: counts.mine },
          { href: "/tasks/board", label: "Board" },
          { href: "/tasks/calendar", label: "Calendar" },
          { href: "/tasks/overdue", label: "Overdue", count: counts.overdue, countTone: "danger" },
          { href: "/tasks/workload", label: "Team workload" },
          ...(counts.canReview
            ? [{ href: "/tasks/review", label: "Review queue", count: counts.review }]
            : []),
        ]}
      />
      {children}
    </>
  );
}
