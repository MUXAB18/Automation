import { notFound } from "next/navigation";
import { listAgenciesWith, listTeam } from "@automation/db";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireActor } from "@/lib/session";
import { revokeInvitationAction } from "./actions";
import { EditMemberForm, InviteForm, RemoveMemberForm } from "./forms";

export const metadata = { title: "Team" };

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ agency?: string }>;
}) {
  const actor = await requireActor();
  // Only agencies where this user may manage people are ever offered; the id from the URL is
  // matched against that list and then re-authorised inside listTeam.
  const agencies = await listAgenciesWith(actor, "agency.members");
  if (agencies.length === 0) notFound();
  const { agency: requested } = await searchParams;
  const agency = agencies.find((a) => a.id === requested) ?? agencies[0]!;
  const team = await listTeam(actor, agency.id);

  return (
    <>
      <PageHeader title="Team" description={`People and access for ${agency.name}.`} />

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Invite someone</CardTitle>
          </CardHeader>
          <CardContent>
            <InviteForm agencyId={agency.id} roles={team.roles} clients={team.clients} />
          </CardContent>
        </Card>

        {team.invitations.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Pending invitations</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {team.invitations.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                  >
                    <div>
                      <p className="font-medium">{inv.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {inv.client ? `Only ${inv.client.name}` : "Whole agency"} ·{" "}
                        {inv.roles.map((r) => r.role.name).join(", ")} · expires{" "}
                        {inv.expiresAt.toLocaleDateString("en-CA")}
                      </p>
                    </div>
                    <form action={revokeInvitationAction}>
                      <input type="hidden" name="agencyId" value={agency.id} />
                      <input type="hidden" name="invitationId" value={inv.id} />
                      <Button type="submit" variant="outline" size="sm">
                        Revoke
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Members ({team.members.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {team.members.map((m) => (
                <li key={m.id} className="py-3 text-sm">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                      <span>
                        <span className="font-medium">{m.user.name}</span>{" "}
                        <span className="text-muted-foreground">{m.user.email}</span>
                        {m.user.deactivatedAt ? (
                          <Badge tone="warning" className="ml-2">
                            Deactivated
                          </Badge>
                        ) : null}
                      </span>
                      <span className="flex flex-wrap gap-1">
                        {m.roles.length === 0 ? (
                          <Badge>No agency role</Badge>
                        ) : (
                          m.roles.map((r) => (
                            <Badge key={r.role.key} tone="success">
                              {r.role.name}
                            </Badge>
                          ))
                        )}
                        {m.clientMemberships.length > 0 ? (
                          <Badge>
                            {m.clientMemberships.length} client
                            {m.clientMemberships.length > 1 ? "s" : ""}
                          </Badge>
                        ) : null}
                      </span>
                    </summary>
                    <div className="mt-4 grid gap-4 rounded-lg bg-muted/40 p-4">
                      {m.clientMemberships.length > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Client access:{" "}
                          {m.clientMemberships
                            .map(
                              (c) =>
                                `${c.client.name} (${c.roles.map((r) => r.role.key).join(", ")})`,
                            )
                            .join("; ")}
                        </p>
                      ) : null}
                      <EditMemberForm
                        agencyId={agency.id}
                        userId={m.userId}
                        roles={team.roles}
                        selected={m.roles.map((r) => r.role.key)}
                        allClientsAccess={m.allClientsAccess}
                      />
                      <RemoveMemberForm agencyId={agency.id} userId={m.userId} name={m.user.name} />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
