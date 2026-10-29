import { listClientTeam } from "@automation/db";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { orNotFound } from "@/lib/guard";
import { requireActor } from "@/lib/session";
import {
  addMemberAction,
  removeMemberConfirmAction,
  setMemberRolesAction,
  setOwnerAction,
} from "../../actions";
import { AddMemberForm, EditRolesForm, OwnerForm } from "./forms";

export const metadata = { title: "Client team" };

export default async function ClientTeamPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const team = await orNotFound(listClientTeam(actor, id));
  const eligibleOwners = [
    ...team.members.filter((m) => m.status === "active" && !m.deactivated),
    ...team.agencyWide,
  ].reduce<{ userId: string; name: string }[]>(
    (all, p) =>
      all.some((x) => x.userId === p.userId) ? all : [...all, { userId: p.userId, name: p.name }],
    [],
  );

  return (
    <div className="grid gap-6">
      {team.canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Account owner</CardTitle>
          </CardHeader>
          <CardContent>
            <OwnerForm
              action={setOwnerAction.bind(null, id)}
              ownerId={team.ownerId}
              options={eligibleOwners}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>People working on this client ({team.members.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {team.members.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">Nobody is assigned directly yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {team.members.map((m) => (
                <li key={m.userId} className="py-3 text-sm">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                      <span>
                        <span className="font-medium">{m.name}</span>{" "}
                        <span className="text-muted-foreground">{m.email}</span>
                        {team.ownerId === m.userId ? (
                          <Badge tone="primary" className="ml-2">
                            Account owner
                          </Badge>
                        ) : null}
                      </span>
                      <span className="flex flex-wrap gap-1">
                        {m.roles.length === 0 ? (
                          <Badge>No role here</Badge>
                        ) : (
                          m.roles.map((r) => (
                            <Badge key={r.key} tone="success">
                              {r.name}
                            </Badge>
                          ))
                        )}
                      </span>
                    </summary>
                    {team.canManage ? (
                      <div className="mt-4 grid gap-4 rounded-lg bg-muted/40 p-4">
                        <EditRolesForm
                          action={setMemberRolesAction.bind(null, id)}
                          userId={m.userId}
                          roles={team.roles}
                          selected={m.roles.map((r) => r.key)}
                        />
                        <ConfirmDialog
                          triggerLabel="Remove from client"
                          triggerClassName="self-start text-destructive"
                          title={`Remove ${m.name} from this client?`}
                          description="They lose access to this client and its projects unless they have agency-wide access. Their tasks here go back to the pool and their history is kept."
                          confirmLabel="Remove person"
                          destructive
                          action={removeMemberConfirmAction.bind(null, id)}
                          fields={{ userId: m.userId }}
                        />
                      </div>
                    ) : null}
                  </details>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {team.agencyWide.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Agency staff with access to every client</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {team.agencyWide.map((p) => (
                <li
                  key={p.userId}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                >
                  <span>
                    <span className="font-medium">{p.name}</span>{" "}
                    <span className="text-muted-foreground">{p.email}</span>
                    {team.ownerId === p.userId ? (
                      <Badge tone="primary" className="ml-2">
                        Account owner
                      </Badge>
                    ) : null}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {p.roles.map((r) => (
                      <Badge key={r.key} tone="outline">
                        {r.name}
                      </Badge>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              These people are managed from the agency Team page.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {team.canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Add someone</CardTitle>
          </CardHeader>
          <CardContent>
            <AddMemberForm
              action={addMemberAction.bind(null, id)}
              candidates={team.candidates}
              roles={team.roles}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
