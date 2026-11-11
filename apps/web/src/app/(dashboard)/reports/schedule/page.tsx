import { notFound } from "next/navigation";
import {
  SECTION_TITLE,
  SECTION_KEYS,
  getReportTemplate,
  getSchedule,
  listAgenciesWith,
} from "@automation/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { orNotFound } from "@/lib/guard";
import { getScope } from "@/lib/scope";
import { requireSection } from "@/lib/sections";
import { requireActor } from "@/lib/session";
import { saveScheduleAction, saveTemplateAction } from "../actions";
import { ScheduleForm, TemplateForm } from "../panels";

export const metadata = { title: "Report schedule" };

export default async function SchedulePage() {
  const actor = await requireActor();
  await requireSection(actor, "reports");
  const scope = await getScope(actor);
  const agencies = await listAgenciesWith(actor, "agency.manage");
  const agency = agencies[0];
  const template = agency ? await getReportTemplate(actor, agency.id) : null;
  const client = scope.clients.find((c) => c.id === scope.clientId);
  const sched = client ? await orNotFound(getSchedule(actor, client.id)) : null;
  if (!sched && !template) notFound();
  const s = sched?.schedule;
  return (
    <>
      <PageHeader
        title="Report schedule and template"
        description="Reports cover 15 days by default and are generated in each client's own time zone."
        breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: "Schedule" }]}
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{client ? `Schedule for ${client.name}` : "Schedule"}</CardTitle>
          </CardHeader>
          <CardContent>
            {client && sched && s ? (
              <ScheduleForm
                action={saveScheduleAction}
                clientId={client.id}
                timezone={sched.timezone}
                values={{
                  enabled: s.enabled,
                  intervalDays: s.intervalDays,
                  anchorDate: s.anchorDate ? new Date(s.anchorDate).toISOString().slice(0, 10) : "",
                  sendHour: s.sendHour,
                  recipients: s.recipients.join(", "),
                  deliverOnApproval: s.deliverOnApproval,
                  nextRunAt: s.nextRunAt
                    ? new Date(s.nextRunAt).toLocaleString("en-CA", {
                        timeZone: sched.timezone,
                        dateStyle: "medium",
                        timeStyle: "short",
                      }) + ` (${sched.timezone})`
                    : null,
                  lastPeriodEnd: s.lastPeriodEnd
                    ? new Date(s.lastPeriodEnd).toISOString().slice(0, 10)
                    : null,
                }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Choose a client in the header to set up its schedule.
              </p>
            )}
          </CardContent>
        </Card>
        {agency && template ? (
          <Card>
            <CardHeader>
              <CardTitle>Agency template</CardTitle>
            </CardHeader>
            <CardContent>
              <TemplateForm
                action={saveTemplateAction}
                agencyId={agency.id}
                sections={SECTION_KEYS.map((key) => ({
                  key,
                  enabled: template.layout.sections.find((x) => x.key === key)?.enabled ?? false,
                }))}
                titles={SECTION_TITLE}
                values={{
                  defaultIntervalDays: template.layout.defaultIntervalDays,
                  useAi: template.layout.useAi,
                  titlePattern: template.layout.titlePattern,
                }}
              />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
