"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { FormField } from "@/components/form-field";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFormToast } from "@/hooks/use-form-toast";
import { useServerForm } from "@/hooks/use-server-form";
import type { FormState } from "@/lib/action-state";
import { errorsFor } from "@/lib/form-errors";
import type { Result } from "./actions";

type Act = (f: FormData) => Promise<Result>;

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (action: Act, fields: Record<string, string>) =>
    start(async () => {
      const data = new FormData();
      for (const [k, v] of Object.entries(fields)) data.set(k, v);
      const r = await action(data);
      if (r.error) toast.error(r.error);
      else {
        toast.success(r.success ?? "Done");
        router.refresh();
      }
    });
  return { pending, run };
}

export function GenerateButton({ clientId, action }: { clientId: string; action: Act }) {
  const { pending, run } = useAct();
  return (
    <Button disabled={pending} onClick={() => run(action, { clientId })}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}Generate report
    </Button>
  );
}

export function ReviewPanel({ reportId, action }: { reportId: string; action: Act }) {
  const { pending, run } = useAct();
  const [note, setNote] = useState("");
  return (
    <div className="grid gap-2">
      <Textarea
        aria-label="Review note"
        rows={2}
        placeholder="Note (required when sending it back)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() => run(action, { reportId, decision: "approve", note })}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(action, { reportId, decision: "request_changes", note })}
        >
          Send back
        </Button>
      </div>
    </div>
  );
}

export function SimpleButton({
  label,
  action,
  fields,
  variant = "outline",
}: {
  label: string;
  action: Act;
  fields: Record<string, string>;
  variant?: "outline" | "default" | "ghost";
}) {
  const { pending, run } = useAct();
  return (
    <Button size="sm" variant={variant} disabled={pending} onClick={() => run(action, fields)}>
      {label}
    </Button>
  );
}

export function SendForm({
  reportId,
  action,
  defaults,
}: {
  reportId: string;
  action: Act;
  defaults: string;
}) {
  const { pending, run } = useAct();
  const [to, setTo] = useState(defaults);
  return (
    <div className="grid gap-2">
      <Textarea
        aria-label="Recipients"
        rows={2}
        placeholder="name@example.com, other@example.com"
        value={to}
        onChange={(e) => setTo(e.target.value)}
      />
      <div>
        <Button
          size="sm"
          disabled={pending || !to.trim()}
          onClick={() => run(action, { reportId, recipients: to })}
        >
          Send as PDF by email
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        An address that already has this report is not sent it twice. Use Resend for that.
      </p>
    </div>
  );
}

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export function ScheduleForm({
  action,
  clientId,
  timezone,
  values,
}: {
  action: Action;
  clientId: string;
  timezone: string;
  values: {
    enabled: boolean;
    intervalDays: number;
    anchorDate: string;
    sendHour: number;
    recipients: string;
    deliverOnApproval: boolean;
    nextRunAt: string | null;
    lastPeriodEnd: string | null;
  };
}) {
  const { state, pending, onSubmit } = useServerForm(action);
  useFormToast(state);
  const fe = state.fieldErrors;
  return (
    <form onSubmit={onSubmit} className="grid max-w-2xl gap-4" noValidate>
      <input type="hidden" name="clientId" value={clientId} />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={values.enabled}
          className="size-4 accent-primary"
        />
        Generate reports automatically
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField
          id="intervalDays"
          label="Days per report"
          hint="Default 15."
          error={errorsFor(fe, "intervalDays")}
        >
          {(c) => (
            <Input
              name="intervalDays"
              type="number"
              min={1}
              max={92}
              defaultValue={values.intervalDays}
              {...c}
            />
          )}
        </FormField>
        <FormField
          id="anchorDate"
          label="First period starts"
          hint={`A date in ${timezone}.`}
          error={errorsFor(fe, "anchorDate")}
        >
          {(c) => <Input name="anchorDate" type="date" defaultValue={values.anchorDate} {...c} />}
        </FormField>
        <FormField
          id="sendHour"
          label={`Generate at (hour, ${timezone})`}
          error={errorsFor(fe, "sendHour")}
        >
          {(c) => (
            <Input
              name="sendHour"
              type="number"
              min={0}
              max={23}
              defaultValue={values.sendHour}
              {...c}
            />
          )}
        </FormField>
      </div>
      <FormField
        id="recipients"
        label="Recipients"
        hint="Separate with commas or new lines."
        error={errorsFor(fe, "recipients")}
      >
        {(c) => <Textarea name="recipients" rows={2} defaultValue={values.recipients} {...c} />}
      </FormField>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="deliverOnApproval"
          defaultChecked={values.deliverOnApproval}
          className="size-4 accent-primary"
        />
        Email the recipients automatically once a reviewer approves the report
      </label>
      <p className="text-xs text-muted-foreground">
        A report is never emailed before a person has approved it.{" "}
        {values.nextRunAt ? `Next run: ${values.nextRunAt}.` : "Not scheduled."}
        {values.lastPeriodEnd ? ` Last period generated ended ${values.lastPeriodEnd}.` : ""}
      </p>
      <FormMessage error={state.error} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}Save schedule
        </Button>
      </div>
    </form>
  );
}

export function TemplateForm({
  action,
  agencyId,
  sections,
  titles,
  values,
}: {
  action: Action;
  agencyId: string;
  sections: { key: string; enabled: boolean }[];
  titles: Record<string, string>;
  values: { defaultIntervalDays: number; useAi: boolean; titlePattern: string };
}) {
  const { state, pending, onSubmit } = useServerForm(action);
  useFormToast(state);
  const fe = state.fieldErrors;
  return (
    <form onSubmit={onSubmit} className="grid max-w-2xl gap-4" noValidate>
      <input type="hidden" name="agencyId" value={agencyId} />
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Sections</legend>
        {sections.map((s) => (
          <label key={s.key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name={`section.${s.key}`}
              defaultChecked={s.enabled}
              className="size-4 accent-primary"
            />
            {titles[s.key]}
          </label>
        ))}
        {errorsFor(fe, "sections") ? (
          <p className="text-xs text-destructive">{errorsFor(fe, "sections")}</p>
        ) : null}
      </fieldset>
      <FormField
        id="titlePattern"
        label="Report title"
        hint="Use {{client}} and {{period}}."
        error={errorsFor(fe, "titlePattern")}
      >
        {(c) => <Input name="titlePattern" defaultValue={values.titlePattern} {...c} />}
      </FormField>
      <FormField
        id="defaultIntervalDays"
        label="Default period (days)"
        error={errorsFor(fe, "defaultIntervalDays")}
      >
        {(c) => (
          <Input
            name="defaultIntervalDays"
            type="number"
            min={1}
            max={92}
            defaultValue={values.defaultIntervalDays}
            {...c}
          />
        )}
      </FormField>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="useAi"
          defaultChecked={values.useAi}
          className="size-4 accent-primary"
        />
        Let AI write the executive summary from the figures (needs a real AI provider; a person
        reviews it before it is sent)
      </label>
      <FormMessage error={state.error} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}Save template
        </Button>
      </div>
    </form>
  );
}
