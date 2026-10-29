import { notFound } from "next/navigation";
import { NotFoundError, can, getCustomer, listAuditLog } from "@automation/db";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireActor } from "@/lib/session";
import { addWebsiteAction, removeWebsiteAction, setStatusAction, updateCustomerAction } from "../actions";
import { CustomerForm } from "../customer-form";
import { StatusControls } from "../status-controls";
import { WebsitesPanel } from "../websites-panel";

export const metadata = { title: "Customer" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;

  let data;
  try {
    data = await getCustomer(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { customer, access } = data;
  const history = await listAuditLog(actor, id);

  return (
    <>
      <PageHeader
        title={customer.name}
        description={customer.slug}
        actions={
          <div className="flex items-center gap-3">
            <StatusBadge status={customer.status} />
            {can(access, "customer.status") ? (
              <StatusControls status={customer.status} action={setStatusAction.bind(null, id)} />
            ) : null}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <CustomerForm
              mode="edit"
              action={updateCustomerAction.bind(null, id)}
              readOnly={!can(access, "customer.update")}
              values={customer}
            />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Websites</CardTitle>
            </CardHeader>
            <CardContent>
              <WebsitesPanel
                websites={customer.websites}
                canManage={can(access, "website.manage")}
                addAction={addWebsiteAction.bind(null, id)}
                removeAction={removeWebsiteAction.bind(null, id)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {history.map((entry) => (
                    <li key={entry.id} className="flex items-baseline justify-between gap-3">
                      <span>
                        <code className="text-xs">{entry.action}</code>{" "}
                        <span className="text-muted-foreground">by {entry.actor?.name ?? "system"}</span>
                      </span>
                      <time className="shrink-0 text-xs text-muted-foreground" dateTime={entry.createdAt.toISOString()}>
                        {entry.createdAt.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
