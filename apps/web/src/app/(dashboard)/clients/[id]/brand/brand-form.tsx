"use client";

import { Loader2 } from "lucide-react";
import { FormField } from "@/components/form-field";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useFormToast } from "@/hooks/use-form-toast";
import { useServerForm } from "@/hooks/use-server-form";
import type { FormState } from "@/lib/action-state";
import { errorsFor } from "@/lib/form-errors";

type Values = {
  toneOfVoice?: string | null;
  audience?: string | null;
  styleNotes?: string | null;
  dos?: string[];
  donts?: string[];
  bannedTerms?: string[];
};

export function BrandForm({
  action,
  values,
  readOnly,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  values: Values;
  readOnly: boolean;
}) {
  const { state, pending, onSubmit } = useServerForm(action);
  useFormToast(state);
  const fe = state.fieldErrors;
  return (
    <form onSubmit={onSubmit} className="grid max-w-3xl gap-5" noValidate>
      <FormField
        id="toneOfVoice"
        label="Tone of voice"
        hint="How should the brand sound? For example: warm, expert, plain-spoken."
        error={errorsFor(fe, "toneOfVoice")}
      >
        {(c) => (
          <Textarea
            name="toneOfVoice"
            defaultValue={values.toneOfVoice ?? ""}
            rows={3}
            maxLength={1000}
            readOnly={readOnly}
            {...c}
          />
        )}
      </FormField>
      <FormField
        id="audience"
        label="Audience"
        hint="Who are we writing for?"
        error={errorsFor(fe, "audience")}
      >
        {(c) => (
          <Textarea
            name="audience"
            defaultValue={values.audience ?? ""}
            rows={3}
            maxLength={1000}
            readOnly={readOnly}
            {...c}
          />
        )}
      </FormField>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="dos" label="Do" hint="One per line." error={errorsFor(fe, "dos")}>
          {(c) => (
            <Textarea
              name="dos"
              defaultValue={(values.dos ?? []).join("\n")}
              rows={5}
              readOnly={readOnly}
              {...c}
            />
          )}
        </FormField>
        <FormField id="donts" label="Don't" hint="One per line." error={errorsFor(fe, "donts")}>
          {(c) => (
            <Textarea
              name="donts"
              defaultValue={(values.donts ?? []).join("\n")}
              rows={5}
              readOnly={readOnly}
              {...c}
            />
          )}
        </FormField>
      </div>
      <FormField
        id="bannedTerms"
        label="Words and phrases to avoid"
        hint="One per line or comma-separated (up to 50)."
        error={errorsFor(fe, "bannedTerms")}
      >
        {(c) => (
          <Textarea
            name="bannedTerms"
            defaultValue={(values.bannedTerms ?? []).join("\n")}
            rows={3}
            readOnly={readOnly}
            {...c}
          />
        )}
      </FormField>
      <FormField
        id="styleNotes"
        label="Style notes"
        hint="Formatting, hashtags, spelling (CA/US), anything else."
        error={errorsFor(fe, "styleNotes")}
      >
        {(c) => (
          <Textarea
            name="styleNotes"
            defaultValue={values.styleNotes ?? ""}
            rows={4}
            maxLength={4000}
            readOnly={readOnly}
            {...c}
          />
        )}
      </FormField>
      <FormMessage error={state.error} />
      {readOnly ? (
        <p className="text-sm text-muted-foreground">
          You can read these guidelines but not change them.
        </p>
      ) : (
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Save as new version
          </Button>
        </div>
      )}
    </form>
  );
}
