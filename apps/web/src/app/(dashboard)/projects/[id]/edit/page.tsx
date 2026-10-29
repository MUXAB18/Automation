import { notFound } from "next/navigation";
import { ForbiddenError, NotFoundError, getClient, getProjectForEdit } from "@automation/db";
import { PageHeader } from "@/components/page-header";
import { requireSection } from "@/lib/sections";
import { requireActor } from "@/lib/session";
import { updateProjectAction } from "../../actions";
import { ProjectForm } from "../../project-form";

export const metadata = { title: "Edit project" };

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  await requireSection(actor, "projects");
  const { id } = await params;
  let data;
  try {
    data = await getProjectForEdit(actor, id);
  } catch (error) {
    // Hide the page entirely from people who may not use it (no access and no permission look the same).
    if (error instanceof NotFoundError || error instanceof ForbiddenError) notFound();
    throw error;
  }
  const { project, social, seoTargets, websites, candidates, canManageSeo } = data;
  const day = (d: Date | null) => d?.toISOString().slice(0, 10);
  const client = await getClient(actor, project.clientId);
  return (
    <>
      <PageHeader
        title={`Edit ${project.name}`}
        breadcrumbs={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${id}` },
          { label: "Edit" },
        ]}
      />
      <ProjectForm
        mode="edit"
        action={updateProjectAction.bind(null, id)}
        clientName={client.client.name}
        websites={websites}
        candidates={candidates}
        canManageSeo={canManageSeo}
        values={{
          name: project.name,
          kind: project.kind,
          status: project.status,
          description: project.description,
          goals: project.goals,
          startsOn: day(project.startsOn),
          endsOn: day(project.endsOn),
          memberIds: project.projectMemberships.map((m) => m.userId),
          seo: project.seoProject
            ? {
                websiteId: project.seoProject.websiteId,
                targetCountry: project.seoProject.targetCountry,
                targetLanguage: project.seoProject.targetLanguage,
                keywords: project.seoProject.keywords.map((k) => k.term),
                organicSessionsGoal: seoTargets.organicSessionsGoal,
                topTenKeywordsGoal: seoTargets.topTenKeywordsGoal,
              }
            : null,
          social,
        }}
      />
    </>
  );
}
