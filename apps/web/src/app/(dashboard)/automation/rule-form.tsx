"use client";

import { Loader2 } from "lucide-react";
import { FormField } from "@/components/form-field";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useFormToast } from "@/hooks/use-form-toast";
import { useServerForm } from "@/hooks/use-server-form";
import type { FormState } from "@/lib/action-state";
import { errorsFor } from "@/lib/form-errors";

type Policy = Record<string, string | number | boolean | string[] | undefined>;

export type RuleFormValues = {
  name: string;
  description?: string;
  kind: string;
  severity: string;
  intervalMinutes: number;
  config: Record<string, unknown>;
  assignment: Policy;
  taskTemplate: Policy;
  duePolicy: Policy;
  notifyPolicy: Policy;
  cooldown: Policy;
  projectId?: string | null;
  enabled?: boolean;
};

const ENUM_CONFIG: Record<string, { value: string; label: string }[]> = {
  metric: [
    { value: "ga4_organic", label: "Organic sessions (Google Analytics)" },
    { value: "gsc_clicks", label: "Clicks (Search Console)" },
  ],
  minSeverity: ["low", "medium", "high", "critical"].map((v) => ({ value: v, label: v })),
};

/** Plain-language names for the settings of each rule type. Unknown keys fall back to a readable form of the key. */
const CONFIG_LABEL: Record<string, string> = {
  importantTag: "Tag that marks important keywords",
  positionDrop: "Alert when the position drops by at least",
  compareDays: "Compare with this many days earlier",
  maxStaleDays: "Skip when the newest data is older than (days)",
  includeLostRankings: "Also alert when a keyword drops out of the results",
  minSeverity: "Lowest severity to act on",
  maxAuditAgeDays: "Skip when the last audit is older than (days)",
  windowDays: "Look at this many days",
  minImpressions: "Minimum impressions",
  minPosition: "Best position to consider",
  maxPosition: "Worst position to consider",
  maxCtr: "Click-through rate below (0.03 = 3%)",
  maxFindings: "Most pages to flag at once",
  metric: "Measure",
  dropPercent: "Alert when traffic falls by at least (%)",
  minBaseline: "Ignore when the earlier period had fewer than",
  hoursAhead: "Alert when due within (hours)",
  includeMissed: "Also alert on items that missed their date",
  graceHours: "Grace period after the due time (hours)",
  escalateAfterDays: "Tell managers after (days overdue)",
  consecutiveFailures: "Alert after this many failed syncs in a row",
  includeNeedsReauth: "Also alert when the account needs reconnecting",
};
const humanise = (key: string) => key.replace(/([A-Z])/g, " $1").toLowerCase();

const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);

function Check({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="size-4 accent-primary"
      />
      {label}
    </label>
  );
}

export function RuleForm({
  action,
  mode,
  ownerKind,
  ownerId,
  ownerName,
  kindLabel,
  values,
  roleOptions,
  projects,
  notifyOnly,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  mode: "create" | "edit";
  /** Whose rule this is: a client, or an agency (template). */
  ownerKind: "client" | "agency";
  ownerId?: string;
  ownerName: string;
  kindLabel: string;
  values: RuleFormValues;
  roleOptions: { value: string; label: string }[];
  projects: { id: string; name: string }[];
  /** This rule type only warns people; it never creates tasks. */
  notifyOnly: boolean;
}) {
  const { state, pending, onSubmit } = useServerForm(action);
  useFormToast(state);
  const fe = state.fieldErrors;
  const t = values.taskTemplate;
  const a = values.assignment;
  const d = values.duePolicy;
  const n = values.notifyPolicy;
  const c = values.cooldown;

  return (
    <form onSubmit={onSubmit} className="grid max-w-3xl gap-6" noValidate>
      {ownerId ? (
        <input
          type="hidden"
          name={ownerKind === "client" ? "clientId" : "agencyId"}
          value={ownerId}
        />
      ) : null}
      <input type="hidden" name="kind" value={values.kind} />
      <p className="text-sm text-muted-foreground">
        {ownerKind === "client" ? "Client" : "Agency"}:{" "}
        <span className="font-medium text-foreground">{ownerName}</span>
        {" · "}Type: <span className="font-medium text-foreground">{kindLabel}</span>
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Rule</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="name"
            label="Name"
            required
            error={errorsFor(fe, "name")}
            className="sm:col-span-2"
          >
            {(p) => <Input name="name" defaultValue={values.name} maxLength={120} {...p} />}
          </FormField>
          <FormField
            id="description"
            label="Description"
            error={errorsFor(fe, "description")}
            className="sm:col-span-2"
          >
            {(p) => (
              <Textarea
                name="description"
                defaultValue={values.description ?? ""}
                rows={2}
                maxLength={1000}
                {...p}
              />
            )}
          </FormField>
          <FormField
            id="severity"
            label="Severity"
            hint="Sets task priority and the default due date."
            error={errorsFor(fe, "severity")}
          >
            {(p) => (
              <NativeSelect name="severity" defaultValue={values.severity} {...p}>
                {["info", "low", "medium", "high", "critical"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField
            id="intervalMinutes"
            label="Check every (minutes)"
            error={errorsFor(fe, "intervalMinutes")}
          >
            {(p) => (
              <Input
                name="intervalMinutes"
                type="number"
                min={5}
                max={10080}
                defaultValue={values.intervalMinutes}
                {...p}
              />
            )}
          </FormField>
          {ownerKind === "client" && projects.length > 0 ? (
            <FormField
              id="projectId"
              label="Project"
              hint="Leave empty to watch the whole client."
              error={errorsFor(fe, "projectId")}
            >
              {(p) => (
                <NativeSelect name="projectId" defaultValue={values.projectId ?? ""} {...p}>
                  <option value="">Whole client</option>
                  {projects.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          ) : null}
          {mode === "create" ? (
            <div className="flex items-end pb-2">
              <Check name="enabled" label="Turn the rule on right away" defaultChecked={false} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conditions</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {Object.entries(values.config).map(([key, v]) => {
            const label = CONFIG_LABEL[key] ?? humanise(key);
            const err = errorsFor(fe, `config.${key}`);
            if (typeof v === "boolean")
              return (
                <div key={key} className="flex items-end pb-2 sm:col-span-2">
                  <Check name={`config.${key}`} label={label} defaultChecked={v} />
                </div>
              );
            if (ENUM_CONFIG[key])
              return (
                <FormField key={key} id={`config-${key}`} label={label} error={err}>
                  {(p) => (
                    <NativeSelect name={`config.${key}`} defaultValue={str(v)} {...p}>
                      {ENUM_CONFIG[key]!.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
              );
            return (
              <FormField key={key} id={`config-${key}`} label={label} error={err}>
                {(p) =>
                  typeof v === "number" ? (
                    <Input
                      name={`config.${key}`}
                      type="number"
                      step="any"
                      defaultValue={v}
                      {...p}
                    />
                  ) : (
                    <Input name={`config.${key}`} defaultValue={str(v)} {...p} />
                  )
                }
              </FormField>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{notifyOnly ? "Message" : "Task"}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {notifyOnly ? (
            <p className="text-sm text-muted-foreground">
              This rule only tells people. It never creates tasks, so an overdue task cannot spawn
              more work.
            </p>
          ) : (
            <Check
              name="task.recordOnly"
              label="Record findings and notify only; do not create tasks"
              defaultChecked={t.createTask === false}
            />
          )}
          <FormField
            id="task-title"
            label={notifyOnly ? "Notification title" : "Task title"}
            required
            hint="Use {{name}} placeholders such as {{keyword}} or {{url}}."
            error={errorsFor(fe, "taskTemplate.title")}
          >
            {(p) => <Input name="task.title" defaultValue={str(t.title)} maxLength={200} {...p} />}
          </FormField>
          {notifyOnly ? null : (
            <>
              <FormField
                id="task-description"
                label="Description"
                error={errorsFor(fe, "taskTemplate.description")}
              >
                {(p) => (
                  <Textarea
                    name="task.description"
                    defaultValue={str(t.description)}
                    rows={4}
                    maxLength={4000}
                    {...p}
                  />
                )}
              </FormField>
              <FormField
                id="task-criteria"
                label="Acceptance criteria"
                hint="One line per condition that must be true when the task is done."
                error={errorsFor(fe, "taskTemplate.acceptanceCriteria")}
              >
                {(p) => (
                  <Textarea
                    name="task.acceptanceCriteria"
                    defaultValue={str(t.acceptanceCriteria)}
                    rows={4}
                    maxLength={4000}
                    {...p}
                  />
                )}
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  id="task-type"
                  label="Task type"
                  error={errorsFor(fe, "taskTemplate.type")}
                >
                  {(p) => (
                    <NativeSelect name="task.type" defaultValue={str(t.type, "seo_fix")} {...p}>
                      {[
                        ["general", "General"],
                        ["seo_fix", "SEO fix"],
                        ["content", "Content"],
                        ["social", "Social media"],
                        ["reporting", "Reporting"],
                      ].map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
                <FormField
                  id="task-labels"
                  label="Labels"
                  hint="Separate with commas."
                  error={errorsFor(fe, "taskTemplate.labels")}
                >
                  {(p) => (
                    <Input
                      name="task.labels"
                      defaultValue={Array.isArray(t.labels) ? t.labels.join(", ") : ""}
                      {...p}
                    />
                  )}
                </FormField>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {notifyOnly ? null : (
        <Card>
          <CardHeader>
            <CardTitle>Assignment and due date</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="assignment-mode"
              label="Assign to"
              error={errorsFor(fe, "assignment.mode")}
            >
              {(p) => (
                <NativeSelect name="assignment.mode" defaultValue={str(a.mode, "role")} {...p}>
                  <option value="role">Someone with a role</option>
                  <option value="entity_owner">
                    Owner of the item, else someone with the role
                  </option>
                  <option value="review_queue">Nobody: tell the reviewers</option>
                </NativeSelect>
              )}
            </FormField>
            <FormField
              id="assignment-role"
              label="Role"
              error={errorsFor(fe, "assignment.roleKey")}
            >
              {(p) => (
                <NativeSelect
                  name="assignment.roleKey"
                  defaultValue={str(a.roleKey, "seo_specialist")}
                  {...p}
                >
                  {roleOptions.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField
              id="assignment-strategy"
              label="When several people qualify"
              error={errorsFor(fe, "assignment.strategy")}
            >
              {(p) => (
                <NativeSelect
                  name="assignment.strategy"
                  defaultValue={str(a.strategy, "least_loaded")}
                  {...p}
                >
                  <option value="least_loaded">The one with the fewest open tasks</option>
                  <option value="first">The first one (alphabetical)</option>
                </NativeSelect>
              )}
            </FormField>
            <div className="hidden sm:block" />
            <FormField id="due-mode" label="Due date" error={errorsFor(fe, "duePolicy.mode")}>
              {(p) => (
                <NativeSelect name="due.mode" defaultValue={str(d.mode, "by_severity")} {...p}>
                  <option value="by_severity">By severity (urgent work sooner)</option>
                  <option value="days">A fixed number of days</option>
                </NativeSelect>
              )}
            </FormField>
            <FormField
              id="due-days"
              label="Days (fixed only)"
              error={errorsFor(fe, "duePolicy.days")}
            >
              {(p) => (
                <Input
                  name="due.days"
                  type="number"
                  min={0}
                  max={365}
                  defaultValue={num(d.days, 7)}
                  {...p}
                />
              )}
            </FormField>
            <div className="sm:col-span-2">
              <Check
                name="due.businessDays"
                label="Count working days only (skip weekends)"
                defaultChecked={d.businessDays !== false}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Notifications and limits</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2 sm:col-span-2">
            <Check
              name="notify.enabled"
              label="Notify people about new findings"
              defaultChecked={n.enabled !== false}
            />
            <Check
              name="notify.assignee"
              label="The assignee or owner"
              defaultChecked={n.assignee !== false}
            />
            <Check
              name="notify.managers"
              label="Managers of the client"
              defaultChecked={n.managers === true}
            />
            <Check
              name="notify.reviewers"
              label="Reviewers"
              defaultChecked={n.reviewers === true}
            />
          </div>
          <FormField
            id="renotify"
            label="Remind again after (hours, 0 = never)"
            error={errorsFor(fe, "notifyPolicy.reNotifyHours")}
          >
            {(p) => (
              <Input
                name="notify.reNotifyHours"
                type="number"
                min={0}
                defaultValue={num(n.reNotifyHours, 0)}
                {...p}
              />
            )}
          </FormField>
          {notifyOnly ? null : (
            <>
              <FormField
                id="cooldown"
                label="Wait after a task is closed (hours)"
                hint="Before the same finding can create a new task."
                error={errorsFor(fe, "cooldown.hours")}
              >
                {(p) => (
                  <Input
                    name="cooldown.hours"
                    type="number"
                    min={0}
                    defaultValue={num(c.hours, 72)}
                    {...p}
                  />
                )}
              </FormField>
              <FormField
                id="max-run"
                label="Most tasks per run"
                error={errorsFor(fe, "cooldown.maxTasksPerRun")}
              >
                {(p) => (
                  <Input
                    name="cooldown.maxTasksPerRun"
                    type="number"
                    min={1}
                    defaultValue={num(c.maxTasksPerRun, 10)}
                    {...p}
                  />
                )}
              </FormField>
              <FormField
                id="max-open"
                label="Stop at this many open automation tasks"
                error={errorsFor(fe, "cooldown.maxOpenTasks")}
              >
                {(p) => (
                  <Input
                    name="cooldown.maxOpenTasks"
                    type="number"
                    min={1}
                    defaultValue={num(c.maxOpenTasks, 50)}
                    {...p}
                  />
                )}
              </FormField>
            </>
          )}
        </CardContent>
      </Card>

      <FormMessage error={state.error} />
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {mode === "create" ? "Create rule" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
