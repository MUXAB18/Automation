import { getBrandGuidelines } from "@automation/db";
import { formatDate } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { orNotFound } from "@/lib/guard";
import { requireActor } from "@/lib/session";
import { saveBrandAction } from "../../actions";
import { BrandForm } from "./brand-form";

export const metadata = { title: "Brand guidelines" };

export default async function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const brand = await orNotFound(getBrandGuidelines(actor, id));
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>
            {brand.active
              ? `Current guidelines (version ${brand.active.version})`
              : "Brand guidelines"}
          </CardTitle>
          {brand.active ? <Badge tone="success">Active</Badge> : <Badge>None yet</Badge>}
        </CardHeader>
        <CardContent>
          <BrandForm
            action={saveBrandAction.bind(null, id)}
            values={brand.active ?? {}}
            readOnly={!brand.canEdit}
          />
        </CardContent>
      </Card>
      {brand.history.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Earlier versions</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {brand.history
                .filter((v) => !v.isActive)
                .map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <span className="font-medium">Version {v.version}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(v.createdAt)} by {v.createdBy?.name ?? "unknown"}
                    </span>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
