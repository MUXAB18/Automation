import { can, listTimeZones } from "@automation/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadClient } from "@/lib/cached";
import { orderedTimeZones } from "@/lib/time-zones";
import { orNotFound } from "@/lib/guard";
import { requireActor } from "@/lib/session";
import { addWebsiteAction, removeWebsiteConfirmAction, updateClientAction } from "../../actions";
import { ClientForm } from "../../client-form";
import { WebsitesPanel } from "../../websites-panel";

export const metadata = { title: "Client settings" };

export default async function ClientSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const { client, access, preferences } = await orNotFound(loadClient(actor, id));
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <ClientForm
            mode="edit"
            action={updateClientAction.bind(null, id)}
            readOnly={!can(access, "client.update")}
            timeZones={orderedTimeZones(listTimeZones())}
            values={{ ...client, preferences }}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Websites</CardTitle>
        </CardHeader>
        <CardContent>
          <WebsitesPanel
            websites={client.websites}
            canManage={can(access, "website.manage")}
            addAction={addWebsiteAction.bind(null, id)}
            removeConfirmAction={removeWebsiteConfirmAction.bind(null, id)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
