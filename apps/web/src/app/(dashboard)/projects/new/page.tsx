import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ForbiddenError,
  NotFoundError,
  listClientsForProjects,
  getProjectFormOptions,
} from "@automation/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getScope } from "@/lib/scope";
import { requireSection } from "@/lib/sections";
import { str, type RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";
import { createProjectAction } from "../actions";
import { ProjectForm } from "../project-form";

export const metadata = { title: "New project" };

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const actor = await requireActor();
  await requireSection(actor, "projects");
  const raw = await searchParams;
  const crumbs = [{ label: "Projects", href: "/projects" }, { label: "New project" }];
  const creatable = await listClientsForProjects(actor);
  if (creatable.length === 0) notFound();

  const scope = await getScope(actor);
  const clientId =
    str(raw.client) ??
    (scope.clientId && creatable.some((c) => c.id === scope.clientId) ? scope.clientId : undefined);

  if (!clientId) {
    return (
      <>
        <PageHeader
          title="New project"
          description="Which client is this project for?"
          breadcrumbs={crumbs}
        />
        <Card>
          <CardContent className="pt-6">
            <ul className="divide-y divide-border">
              {creatable.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/projects/new?client=${c.id}`}
                    className="flex items-center justify-between py-3 text-sm font-medium hover:underline"
                  >
                    {c.name}
                    <span aria-hidden className="text-muted-foreground">
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </>
    );
  }

  let options;
  try {
    options = await getProjectFormOptions(actor, clientId);
  } catch (error) {
    // Hide the page entirely from people who may not use it (no access and no permission look the same).
    if (error instanceof NotFoundError || error instanceof ForbiddenError) notFound();
    throw error;
  }
  if (!options.client) notFound();
  return (
    <>
      <PageHeader
        title="New project"
        description={`A programme of work for ${options.client.name}.`}
        breadcrumbs={crumbs}
      />
      {options.websites.length === 0 ? (
        <p className="mb-4 rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          This client has no website yet, so SEO targets can&rsquo;t be set.{" "}
          <Link className="text-primary hover:underline" href={`/clients/${clientId}/edit`}>
            Add one in the client settings.
          </Link>
        </p>
      ) : null}
      <ProjectForm
        mode="create"
        action={createProjectAction}
        clientId={clientId}
        clientName={options.client.name}
        websites={options.websites}
        candidates={options.candidates}
        canManageSeo={options.canManageSeo}
      />
    </>
  );
}
