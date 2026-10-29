"use client";

import { Loader2 } from "lucide-react";
import { FormField } from "@/components/form-field";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useFormToast } from "@/hooks/use-form-toast";
import { useServerForm } from "@/hooks/use-server-form";
import type { FormState } from "@/lib/action-state";
import { errorsFor } from "@/lib/form-errors";

export type ClientFormValues = {
  name?: string;
  slug?: string;
  industry?: string | null;
  goals?: string | null;
  targetLocations?: string[];
  timezone?: string;
  locale?: string;
  reportEmail?: string | null;
  reportIntervalDays?: number;
  preferences?: { reportDelivery?: string; reportWeekday?: number; weeklySummary?: boolean };
};

const LOCALES = [
  { value: "en-CA", label: "English (Canada)" },
  { value: "fr-CA", label: "Français (Canada)" },
  { value: "en-US", label: "English (United States)" },
  { value: "en-GB", label: "English (United Kingdom)" },
];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="grid gap-4 border-t border-border pt-6 first:border-0 first:pt-0">
      <legend className="sr-only">{title}</legend>
      <div aria-hidden>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </fieldset>
  );
}

export function ClientForm({
  action,
  mode,
  values = {},
  readOnly = false,
  timeZones,
  agencies,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  mode: "create" | "edit";
  values?: ClientFormValues;
  readOnly?: boolean;
  timeZones: string[];
  /** Only when the user can create clients in more than one agency. */
  agencies?: { id: string; name: string }[];
}) {
  const { state, pending, onSubmit } = useServerForm(action);
  useFormToast(state);
  const fe = state.fieldErrors;
  const p = values.preferences ?? {};
  const disabled = readOnly;

  return (
    <form onSubmit={onSubmit} className="grid max-w-3xl gap-6" noValidate>
      <Section title="Business" description="Who the client is.">
        <FormField id="name" label="Business name" required error={errorsFor(fe, "name")}>
          {(c) => (
            <Input
              name="name"
              defaultValue={values.name}
              maxLength={120}
              readOnly={disabled}
              {...c}
            />
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="industry"
            label="Industry"
            hint="For example: Logistics, Dental, Retail."
            error={errorsFor(fe, "industry")}
          >
            {(c) => (
              <Input
                name="industry"
                defaultValue={values.industry ?? ""}
                maxLength={120}
                readOnly={disabled}
                {...c}
              />
            )}
          </FormField>
          {mode === "create" ? (
            <FormField
              id="primaryDomain"
              label="Website"
              hint="Optional. More websites can be added later."
              error={errorsFor(fe, "primaryDomain")}
            >
              {(c) => (
                <Input name="primaryDomain" placeholder="example.com" inputMode="url" {...c} />
              )}
            </FormField>
          ) : (
            <FormField
              id="slug"
              label="Address name"
              required
              hint="Lowercase letters, numbers and dashes."
              error={errorsFor(fe, "slug")}
            >
              {(c) => <Input name="slug" defaultValue={values.slug} readOnly={disabled} {...c} />}
            </FormField>
          )}
        </div>
        {mode === "create" ? (
          <FormField
            id="slug"
            label="Address name"
            hint="Optional. Made from the name if left empty."
            error={errorsFor(fe, "slug")}
          >
            {(c) => <Input name="slug" {...c} />}
          </FormField>
        ) : null}
        {agencies && agencies.length > 1 ? (
          <FormField id="agencyId" label="Agency" required error={errorsFor(fe, "agencyId")}>
            {(c) => (
              <NativeSelect name="agencyId" defaultValue="" {...c}>
                <option value="" disabled>
                  Choose an agency
                </option>
                {agencies.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
        ) : null}
      </Section>

      <Section
        title="Goals and locations"
        description="Used by the whole team and by AI-assisted drafts."
      >
        <FormField
          id="goals"
          label="Goals"
          hint="What does this client want to achieve? Up to 4,000 characters."
          error={errorsFor(fe, "goals")}
        >
          {(c) => (
            <Textarea
              name="goals"
              defaultValue={values.goals ?? ""}
              rows={4}
              maxLength={4000}
              readOnly={disabled}
              {...c}
            />
          )}
        </FormField>
        <FormField
          id="targetLocations"
          label="Target locations"
          hint="One per line (up to 25), e.g. “Ottawa, ON”."
          error={errorsFor(fe, "targetLocations")}
        >
          {(c) => (
            <Textarea
              name="targetLocations"
              defaultValue={(values.targetLocations ?? []).join("\n")}
              rows={3}
              readOnly={disabled}
              {...c}
            />
          )}
        </FormField>
      </Section>

      <Section title="Time zone and language">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="timezone"
            label="Time zone"
            required
            hint="Schedules and reports use this."
            error={errorsFor(fe, "timezone")}
          >
            {(c) => (
              <NativeSelect
                name="timezone"
                defaultValue={values.timezone ?? "America/Toronto"}
                disabled={disabled}
                {...c}
              >
                {timeZones.map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, " ")}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField id="locale" label="Language and region" error={errorsFor(fe, "locale")}>
            {(c) => (
              <NativeSelect
                name="locale"
                defaultValue={values.locale ?? "en-CA"}
                disabled={disabled}
                {...c}
              >
                {LOCALES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
        </div>
      </Section>

      <Section
        title="Reporting schedule and preferences"
        description="When and how this client receives performance reports."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="reportEmail"
            label="Report email"
            hint="Where reports are sent."
            error={errorsFor(fe, "reportEmail")}
          >
            {(c) => (
              <Input
                name="reportEmail"
                type="email"
                defaultValue={values.reportEmail ?? ""}
                readOnly={disabled}
                {...c}
              />
            )}
          </FormField>
          <FormField
            id="reportIntervalDays"
            label="Report every (days)"
            required
            error={errorsFor(fe, "reportIntervalDays")}
          >
            {(c) => (
              <Input
                name="reportIntervalDays"
                type="number"
                min={1}
                max={365}
                defaultValue={values.reportIntervalDays ?? 15}
                readOnly={disabled}
                {...c}
              />
            )}
          </FormField>
          <FormField
            id="preferences.reportDelivery"
            label="Delivery"
            error={errorsFor(fe, "preferences.reportDelivery")}
          >
            {(c) => (
              <NativeSelect
                name="preferences.reportDelivery"
                defaultValue={p.reportDelivery ?? "email"}
                disabled={disabled}
                {...c}
              >
                <option value="email">Email the report</option>
                <option value="download">Download from the dashboard only</option>
              </NativeSelect>
            )}
          </FormField>
          <FormField
            id="preferences.reportWeekday"
            label="Preferred weekday"
            hint="Optional."
            error={errorsFor(fe, "preferences.reportWeekday")}
          >
            {(c) => (
              <NativeSelect
                name="preferences.reportWeekday"
                defaultValue={p.reportWeekday ? String(p.reportWeekday) : ""}
                disabled={disabled}
                {...c}
              >
                <option value="">No preference</option>
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i + 1}>
                    {d}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="preferences.weeklySummary"
            defaultChecked={p.weeklySummary}
            disabled={disabled}
          />
          Send a short summary every week between reports
        </label>
      </Section>

      <FormMessage error={state.error} />
      {readOnly ? (
        <p className="text-sm text-muted-foreground">You have read-only access to this client.</p>
      ) : (
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {mode === "create" ? "Create client" : "Save changes"}
          </Button>
        </div>
      )}
    </form>
  );
}
