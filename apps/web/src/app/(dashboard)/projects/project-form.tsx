"use client";

import { useState } from "react";
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

const KINDS = [
  { value: "seo", label: "SEO", hint: "Rankings, audits and technical fixes for a website" },
  { value: "social", label: "Social media", hint: "Posting plan across social channels" },
  { value: "content", label: "Content", hint: "Articles and pages" },
  { value: "general", label: "General", hint: "Anything else" },
];
const CHANNELS = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "x", label: "X" },
  { value: "google_business", label: "Google Business Profile" },
];

export type ProjectFormValues = {
  name?: string;
  kind?: string;
  status?: string;
  description?: string | null;
  goals?: string | null;
  startsOn?: string;
  endsOn?: string;
  memberIds?: string[];
  seo?: {
    websiteId?: string;
    targetCountry?: string;
    targetLanguage?: string;
    keywords?: string[];
    organicSessionsGoal?: number | null;
    topTenKeywordsGoal?: number | null;
  } | null;
  social?: { channels?: string[]; postsPerWeek?: number; requirements?: string | null } | null;
};

function Block({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="grid gap-4 border-t border-border pt-6">
      <legend className="sr-only">{title}</legend>
      <div aria-hidden>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </fieldset>
  );
}

export function ProjectForm({
  action,
  mode,
  clientId,
  clientName,
  values = {},
  websites,
  candidates,
  canManageSeo,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  mode: "create" | "edit";
  clientId?: string;
  clientName: string;
  values?: ProjectFormValues;
  websites: { id: string; domain: string }[];
  candidates: { userId: string; name: string; email: string; roles: string[] }[];
  canManageSeo: boolean;
}) {
  const { state, pending, onSubmit } = useServerForm(action);
  useFormToast(state);
  const fe = state.fieldErrors;
  const [kind, setKind] = useState(values.kind ?? "general");
  const [seoToggle, setSeoToggle] = useState(Boolean(values.seo));
  const [socialToggle, setSocialToggle] = useState(Boolean(values.social));
  const seoOn = kind === "seo" || seoToggle;
  const socialOn = kind === "social" || socialToggle;
  const seo = values.seo ?? {};
  const social = values.social ?? {};

  return (
    <form onSubmit={onSubmit} className="grid max-w-3xl gap-6" noValidate>
      {clientId ? <input type="hidden" name="clientId" value={clientId} /> : null}
      <p className="text-sm text-muted-foreground">
        Client: <span className="font-medium text-foreground">{clientName}</span>
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="name"
          label="Project name"
          required
          className="sm:col-span-2"
          error={errorsFor(fe, "name")}
        >
          {(c) => <Input name="name" defaultValue={values.name} maxLength={120} {...c} />}
        </FormField>
        <FormField id="kind" label="Type" required error={errorsFor(fe, "kind")}>
          {(c) => (
            <NativeSelect name="kind" value={kind} onChange={(e) => setKind(e.target.value)} {...c}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="status" label="Status" error={errorsFor(fe, "status")}>
          {(c) => (
            <NativeSelect name="status" defaultValue={values.status ?? "active"} {...c}>
              {["active", "paused", "completed", "archived"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="startsOn" label="Start date" error={errorsFor(fe, "startsOn")}>
          {(c) => <Input name="startsOn" type="date" defaultValue={values.startsOn} {...c} />}
        </FormField>
        <FormField id="endsOn" label="End date" hint="Optional." error={errorsFor(fe, "endsOn")}>
          {(c) => <Input name="endsOn" type="date" defaultValue={values.endsOn} {...c} />}
        </FormField>
      </div>
      <p className="-mt-3 text-xs text-muted-foreground">
        {KINDS.find((k) => k.value === kind)?.hint}
      </p>

      <FormField
        id="goals"
        label="Goals"
        hint="What should this project achieve? Up to 4,000 characters."
        error={errorsFor(fe, "goals")}
      >
        {(c) => (
          <Textarea
            name="goals"
            defaultValue={values.goals ?? ""}
            rows={4}
            maxLength={4000}
            {...c}
          />
        )}
      </FormField>
      <FormField
        id="description"
        label="Notes"
        hint="Optional background for the team."
        error={errorsFor(fe, "description")}
      >
        {(c) => (
          <Textarea
            name="description"
            defaultValue={values.description ?? ""}
            rows={3}
            maxLength={2000}
            {...c}
          />
        )}
      </FormField>

      <Block
        title="People"
        description="Who works on this project. Only people on the client's team can be chosen."
      >
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody is on this client&rsquo;s team yet. Add people from the client&rsquo;s Team tab.
          </p>
        ) : (
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="sr-only">People assigned</legend>
            {candidates.map((p) => (
              <label
                key={p.userId}
                className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
              >
                <input
                  type="checkbox"
                  name="memberIds"
                  value={p.userId}
                  defaultChecked={values.memberIds?.includes(p.userId)}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">{p.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {p.roles.join(", ") || p.email}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {errorsFor(fe, "memberIds") ? (
          <p className="text-xs text-destructive">{errorsFor(fe, "memberIds")}</p>
        ) : null}
      </Block>

      <Block
        title="SEO targets"
        description="The website to optimise, the market, and the keywords to track."
      >
        {kind !== "seo" ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={seoToggle}
              onChange={(e) => setSeoToggle(e.target.checked)}
              disabled={!canManageSeo}
            />{" "}
            This project has SEO targets
          </label>
        ) : null}
        {!canManageSeo ? (
          <p className="text-xs text-muted-foreground">Your role cannot change SEO targets.</p>
        ) : null}
        {seoOn && canManageSeo ? (
          <>
            <input type="hidden" name="seoEnabled" value="on" />
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                id="seo.websiteId"
                label="Website"
                required
                className="sm:col-span-3"
                error={errorsFor(fe, "seo.websiteId")}
              >
                {(c) => (
                  <NativeSelect name="seo.websiteId" defaultValue={seo.websiteId ?? ""} {...c}>
                    <option value="" disabled>
                      {websites.length ? "Choose a website" : "Add a website to the client first"}
                    </option>
                    {websites.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.domain}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              <FormField
                id="seo.targetCountry"
                label="Country"
                hint="2-letter code"
                error={errorsFor(fe, "seo.targetCountry")}
              >
                {(c) => (
                  <Input
                    name="seo.targetCountry"
                    defaultValue={seo.targetCountry ?? "CA"}
                    maxLength={2}
                    {...c}
                  />
                )}
              </FormField>
              <FormField
                id="seo.targetLanguage"
                label="Language"
                hint="en, fr-CA"
                error={errorsFor(fe, "seo.targetLanguage")}
              >
                {(c) => (
                  <Input
                    name="seo.targetLanguage"
                    defaultValue={seo.targetLanguage ?? "en"}
                    maxLength={8}
                    {...c}
                  />
                )}
              </FormField>
              <span />
              <FormField
                id="seo.organicSessionsGoal"
                label="Monthly organic sessions goal"
                error={errorsFor(fe, "seo.organicSessionsGoal")}
              >
                {(c) => (
                  <Input
                    name="seo.organicSessionsGoal"
                    type="number"
                    min={0}
                    defaultValue={seo.organicSessionsGoal ?? ""}
                    {...c}
                  />
                )}
              </FormField>
              <FormField
                id="seo.topTenKeywordsGoal"
                label="Keywords in the top 10"
                error={errorsFor(fe, "seo.topTenKeywordsGoal")}
              >
                {(c) => (
                  <Input
                    name="seo.topTenKeywordsGoal"
                    type="number"
                    min={0}
                    defaultValue={seo.topTenKeywordsGoal ?? ""}
                    {...c}
                  />
                )}
              </FormField>
            </div>
            <FormField
              id="seo.keywords"
              label="Keywords to track"
              hint="One per line or comma-separated, up to 100. Removed keywords stay in history."
              error={errorsFor(fe, "seo.keywords")}
            >
              {(c) => (
                <Textarea
                  name="seo.keywords"
                  defaultValue={(seo.keywords ?? []).join("\n")}
                  rows={5}
                  {...c}
                />
              )}
            </FormField>
          </>
        ) : null}
      </Block>

      <Block
        title="Social media requirements"
        description="Where and how often to post. A content calendar is created for the project."
      >
        {kind !== "social" ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={socialToggle}
              onChange={(e) => setSocialToggle(e.target.checked)}
            />{" "}
            This project has social media requirements
          </label>
        ) : null}
        {socialOn ? (
          <>
            <input type="hidden" name="socialEnabled" value="on" />
            <fieldset className="grid gap-2 sm:grid-cols-3">
              <legend className="mb-1 text-sm font-medium">Channels</legend>
              {CHANNELS.map((ch) => (
                <label
                  key={ch.value}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-border p-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
                >
                  <input
                    type="checkbox"
                    name="social.channels"
                    value={ch.value}
                    defaultChecked={social.channels?.includes(ch.value)}
                  />
                  {ch.label}
                </label>
              ))}
            </fieldset>
            {errorsFor(fe, "social.channels") ? (
              <p className="text-xs text-destructive">{errorsFor(fe, "social.channels")}</p>
            ) : null}
            <FormField
              id="social.postsPerWeek"
              label="Posts per week"
              error={errorsFor(fe, "social.postsPerWeek")}
              className="max-w-40"
            >
              {(c) => (
                <Input
                  name="social.postsPerWeek"
                  type="number"
                  min={1}
                  max={50}
                  defaultValue={social.postsPerWeek ?? 3}
                  {...c}
                />
              )}
            </FormField>
            <FormField
              id="social.requirements"
              label="Requirements"
              hint="Approval rules, hashtags, formats, things to avoid."
              error={errorsFor(fe, "social.requirements")}
            >
              {(c) => (
                <Textarea
                  name="social.requirements"
                  defaultValue={social.requirements ?? ""}
                  rows={4}
                  maxLength={2000}
                  {...c}
                />
              )}
            </FormField>
          </>
        ) : null}
      </Block>

      <FormMessage error={state.error} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {mode === "create" ? "Create project" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
