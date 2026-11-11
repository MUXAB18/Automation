"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelAction,
  regenerateAction,
  reviewAction,
  saveDraftAction,
  type Result,
} from "./actions";

/** Save as draft, regenerate with feedback, record reviewer feedback. The server re-checks every permission. */
export function JobActions({
  jobId,
  status,
  task,
  canSave,
  captionCount,
}: {
  jobId: string;
  status: string;
  task: string;
  canSave: boolean;
  captionCount: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState("");
  const [caption, setCaption] = useState("0");
  const run = (action: (f: FormData) => Promise<Result>, fields: Record<string, string>) =>
    start(async () => {
      const data = new FormData();
      data.set("jobId", jobId);
      for (const [k, v] of Object.entries(fields)) data.set(k, v);
      const r = await action(data);
      if (r.error) return void toast.error(r.error);
      toast.success(r.success ?? "Done");
      if (r.redirectTo) router.push(r.redirectTo);
      else router.refresh();
    });

  if (status === "queued")
    return (
      <Button variant="outline" disabled={pending} onClick={() => run(cancelAction, {})}>
        Cancel
      </Button>
    );
  if (status !== "succeeded" && status !== "failed") return null;
  return (
    <div className="grid gap-3">
      {status === "succeeded" && canSave ? (
        <div className="flex flex-wrap items-center gap-2">
          {task === "social_captions" && captionCount > 1 ? (
            <NativeSelect
              aria-label="Caption to save"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              className="w-40"
            >
              {Array.from({ length: captionCount }, (_, i) => (
                <option key={i} value={i}>
                  Caption {i + 1}
                </option>
              ))}
            </NativeSelect>
          ) : null}
          <Button
            disabled={pending}
            onClick={() => run(saveDraftAction, { captionIndex: caption })}
          >
            Save as draft
          </Button>
          <p className="text-xs text-muted-foreground">
            A draft is not approved. It goes through review before anything is scheduled or
            published.
          </p>
        </div>
      ) : null}
      <Textarea
        aria-label="Feedback"
        placeholder="What should change? (used when you regenerate or mark it as needing work)"
        rows={3}
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => run(regenerateAction, { feedback })}
        >
          Regenerate{feedback ? " with feedback" : ""}
        </Button>
        {status === "succeeded" ? (
          <>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => run(reviewAction, { outcome: "accepted", feedback })}
            >
              Mark as good
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => run(reviewAction, { outcome: "needs_work", feedback })}
            >
              Needs work
            </Button>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => run(reviewAction, { outcome: "rejected", feedback })}
            >
              Reject
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
