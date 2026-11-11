import Link from "next/link";
import { notFound } from "next/navigation";
import { listProjectOptions, requirePermission } from "@automation/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getScope } from "@/lib/scope";
import { requireSection } from "@/lib/sections";
import { str, type RawParams } from "@/lib/search-params";
import { requireActor } from "@/lib/session";
import { createContentAction } from "../actions";
import { NewContentForm } from "./new-form";

export const metadata = { title: "New content" };

export default async function NewContentPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const actor = await requireActor();
  await requireSection(actor, "content");
  const raw = await searchParams;
  const scope = await getScope(actor);
  const crumbs = [{ label: "Content", href: "/content" }, { label: "New content" }];
  const clientId =
    str(raw.client) ??
    scope.clientId ??
    (scope.clients.length === 1 ? scope.clients[0]!.id : undefined);
  const client = scope.clients.find((c) => c.id === clientId);
  if (!client) {
    return (
      <>
        <PageHeader
          title="New content"
          description="Which client is it for?"
          breadcrumbs={crumbs}
        />
        <Card>
          <CardContent className="pt-6">
            <ul className="divide-y divide-border">
              {scope.clients.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/content/new?client=${c.id}`}
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
  const ctx = await requirePermission(actor, client.id, "content.create").catch(() => notFound());
  const projects = await listProjectOptions(actor, client.id);
  const tz = (
    await ctx.db.client.findFirstOrThrow({ where: { id: client.id }, select: { timezone: true } })
  ).timezone;
  return (
    <>
      <PageHeader
        title="New content"
        description="Start with an idea, a brief or a draft. Everything goes through review before it can be published."
        breadcrumbs={crumbs}
      />
      <NewContentForm
        action={createContentAction}
        clientId={client.id}
        clientName={client.name}
        timezone={tz}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      />
    </>
  );
}
