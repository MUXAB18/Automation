"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
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
import type { Result } from "../actions";

type Act = (f: FormData) => Promise<Result>;

function useAct(itemId: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (action: Act, fields: Record<string, string | string[]>) =>
    start(async () => {
      const data = new FormData();
      data.set("itemId", itemId);
      for (const [k, v] of Object.entries(fields))
        for (const x of Array.isArray(v) ? v : [v]) data.append(k, x);
      const r = await action(data);
      if (r.error) toast.error(r.error);
      else {
        toast.success(r.success ?? "Done");
        router.refresh();
      }
    });
  return { pending, run };
}

export type ButtonSpec = {
  label: string;
  action: Act;
  fields?: Record<string, string>;
  variant?: "default" | "outline" | "ghost";
  needsNote?: boolean;
};

/** A row of lifecycle buttons with one shared note box (required by the server for "changes" and "reject"). */
export function WorkflowButtons({
  itemId,
  buttons,
  notePlaceholder,
}: {
  itemId: string;
  buttons: ButtonSpec[];
  notePlaceholder?: string;
}) {
  const { pending, run } = useAct(itemId);
  const [note, setNote] = useState("");
  const showNote = buttons.some((b) => b.needsNote) || !!notePlaceholder;
  return (
    <div className="grid gap-2">
      {showNote ? (
        <Textarea
          aria-label="Note"
          rows={2}
          placeholder={notePlaceholder ?? "Note (required when asking for changes or rejecting)"}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        {buttons.map((b) => (
          <Button
            key={b.label}
            size="sm"
            variant={b.variant ?? "outline"}
            disabled={pending}
            onClick={() => run(b.action, { ...b.fields, note })}
          >
            {b.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function CommentBox({ itemId, action }: { itemId: string; action: Act }) {
  const { pending, run } = useAct(itemId);
  const [body, setBody] = useState("");
  return (
    <div className="grid gap-2">
      <Textarea
        aria-label="Comment"
        rows={2}
        placeholder="Add a comment"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || !body.trim()}
          onClick={() => {
            run(action, { body });
            setBody("");
          }}
        >
          Comment
        </Button>
      </div>
    </div>
  );
}

export function RestoreButton({
  itemId,
  versionNo,
  action,
}: {
  itemId: string;
  versionNo: number;
  action: Act;
}) {
  const { pending, run } = useAct(itemId);
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => run(action, { versionNo: String(versionNo) })}
    >
      Restore
    </Button>
  );
}

export function Editor({
  action,
  values,
  channelLimit,
  expectedVersionNo,
  disabled,
  blog,
}: {
  action: (p: FormState, f: FormData) => Promise<FormState>;
  values: {
    title: string;
    body: string;
    hashtags: string;
    seoTitle: string;
    metaDescription: string;
  };
  channelLimit: number;
  expectedVersionNo: number;
  disabled: boolean;
  blog: boolean;
}) {
  const { state, pending, onSubmit } = useServerForm(action);
  useFormToast(state);
  const [body, setBody] = useState(values.body);
  const [tags, setTags] = useState(values.hashtags);
  const total = body.trim().length + (tags.trim() ? tags.trim().length + 2 : 0);
  const fe = state.fieldErrors;
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <input type="hidden" name="expectedVersionNo" value={expectedVersionNo} />
      <FormField id="title" label="Title" error={errorsFor(fe, "title")}>
        {(c) => (
          <Input
            name="title"
            defaultValue={values.title}
            disabled={disabled}
            maxLength={200}
            {...c}
          />
        )}
      </FormField>
      <FormField
        id="body"
        label="Text"
        required
        error={errorsFor(fe, "body")}
        hint={`${total} of ${channelLimit.toLocaleString()} characters for this channel`}
      >
        {(c) => (
          <Textarea
            name="body"
            rows={blog ? 16 : 7}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={disabled}
            {...c}
          />
        )}
      </FormField>
      <FormField id="hashtags" label="Hashtags" error={errorsFor(fe, "meta.hashtags")}>
        {(c) => (
          <Input
            name="hashtags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            disabled={disabled}
            {...c}
          />
        )}
      </FormField>
      {blog ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="seoTitle" label="SEO title">
            {(c) => (
              <Input name="seoTitle" defaultValue={values.seoTitle} disabled={disabled} {...c} />
            )}
          </FormField>
          <FormField id="metaDescription" label="Meta description">
            {(c) => (
              <Input
                name="metaDescription"
                defaultValue={values.metaDescription}
                disabled={disabled}
                {...c}
              />
            )}
          </FormField>
        </div>
      ) : null}
      <FormField id="changeNote" label="What changed? (optional)">
        {(c) => <Input name="changeNote" maxLength={300} disabled={disabled} {...c} />}
      </FormField>
      <FormMessage error={state.error} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || disabled}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}Save as new version
        </Button>
        <p className="text-xs text-muted-foreground">
          Saving changes after approval sends the content back to draft: a new text needs a new
          review.
        </p>
      </div>
    </form>
  );
}

export function SchedulePanel({
  itemId,
  timezone,
  scheduleAction,
  mode,
  reasons,
  accounts,
}: {
  itemId: string;
  timezone: string;
  scheduleAction: Act;
  mode: "direct" | "manual";
  reasons: string[];
  accounts: {
    id: string;
    name: string;
    socialAccounts: { externalId: string; name: string | null; platform: string | null }[];
  }[];
}) {
  const { pending, run } = useAct(itemId);
  const [when, setWhen] = useState("");
  const [account, setAccount] = useState(mode === "direct" ? (accounts[0]?.id ?? "") : "");
  const [targets, setTargets] = useState<string[]>([]);
  const profiles = accounts.find((a) => a.id === account)?.socialAccounts ?? [];
  return (
    <div className="grid gap-3">
      <FormField id="when" label={`Publish at (${timezone})`}>
        {(c) => (
          <Input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            {...c}
          />
        )}
      </FormField>
      {mode === "direct" ? (
        <>
          <FormField id="account" label="Publish through">
            {(c) => (
              <NativeSelect
                value={account}
                onChange={(e) => {
                  setAccount(e.target.value);
                  setTargets([]);
                }}
                {...c}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
                <option value="">Nobody: I will post it by hand</option>
              </NativeSelect>
            )}
          </FormField>
          {account ? (
            <fieldset className="grid gap-1">
              <legend className="text-sm font-medium">Profiles</legend>
              {profiles.map((p) => (
                <label key={p.externalId} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={targets.includes(p.externalId)}
                    onChange={(e) =>
                      setTargets(
                        e.target.checked
                          ? [...targets, p.externalId]
                          : targets.filter((t) => t !== p.externalId),
                      )
                    }
                  />
                  {p.name ?? p.externalId}{" "}
                  <span className="text-muted-foreground">({p.platform})</span>
                </label>
              ))}
            </fieldset>
          ) : null}
        </>
      ) : (
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
          <li>It will be scheduled for a person to post by hand.</li>
        </ul>
      )}
      <div>
        <Button
          disabled={pending || !when}
          onClick={() =>
            run(scheduleAction, {
              scheduledLocal: when,
              ...(account ? { integrationAccountId: account, targetAccountIds: targets } : {}),
            })
          }
        >
          {account ? "Schedule" : "Schedule for manual posting"}
        </Button>
      </div>
    </div>
  );
}

export function ManualPublishForm({ itemId, action }: { itemId: string; action: Act }) {
  const { pending, run } = useAct(itemId);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  return (
    <div className="grid gap-2">
      <Input
        aria-label="Link to the live post"
        type="url"
        placeholder="https://link-to-the-live-post"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <Input
        aria-label="Note"
        placeholder="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(action, { publishedUrl: url, note })}
        >
          I posted it by hand
        </Button>
      </div>
    </div>
  );
}

export function MediaUpload({
  action,
}: {
  action: (p: FormState, f: FormData) => Promise<FormState>;
}) {
  const { state, pending, onSubmit, formRef } = useServerForm(action);
  useFormToast(state);
  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-2" noValidate>
      <Input
        aria-label="File"
        type="file"
        name="file"
        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime"
      />
      <Input
        aria-label="Alt text"
        name="altText"
        placeholder="Describe the image (alt text)"
        maxLength={500}
      />
      <FormMessage error={state.error} />
      <div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}Attach
        </Button>
      </div>
    </form>
  );
}
