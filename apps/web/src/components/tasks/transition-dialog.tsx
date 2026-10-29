"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { transitionTaskAction } from "@/app/(dashboard)/tasks/actions";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export type MoveView = {
  to: string;
  label: string;
  needs: "note" | "evidence" | null;
  disabledReason?: string;
};

/**
 * One workflow move as a button. Moves that need nothing run straight away; moves that need a reason
 * or evidence ask for it first. The server decides whether the move is allowed (this only offers moves
 * it already knows are valid for this person), and any refusal is shown as a toast.
 */
export function TransitionButton({
  taskId,
  move,
  variant = "outline",
  size = "default",
  existingEvidence,
}: {
  taskId: string;
  move: MoveView;
  variant?: "default" | "outline" | "destructive";
  size?: "default" | "sm";
  existingEvidence?: { note?: string | null; links?: string[] };
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  const run = (data: FormData) =>
    start(async () => {
      const result = await transitionTaskAction(data);
      if (result.error) {
        setError(result.error);
        toast.error(result.error);
      } else {
        toast.success(result.success ?? "Task updated");
        setOpen(false);
        setError(undefined);
      }
    });

  const base = new FormData();
  base.set("taskId", taskId);
  base.set("to", move.to);

  if (!move.needs) {
    return (
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={pending || Boolean(move.disabledReason)}
        title={move.disabledReason}
        onClick={() => run(base)}
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {move.label}
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size={size}
          disabled={Boolean(move.disabledReason)}
          title={move.disabledReason}
        >
          {move.label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(new FormData(e.currentTarget));
          }}
        >
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="to" value={move.to} />
          <DialogHeader>
            <DialogTitle>{move.label}</DialogTitle>
            <DialogDescription>
              {move.needs === "evidence"
                ? "Show the reviewer what was done. A note, links to the finished work, or an attached file is needed."
                : "Say why, in a few words. It is saved in the task's history and shared with the people involved."}
            </DialogDescription>
          </DialogHeader>
          <div className="my-5 grid gap-4">
            {move.needs === "evidence" ? (
              <>
                <FormField
                  id={`ev-${taskId}`}
                  label="What was done"
                  hint="Describe the result and how to check it."
                >
                  {(c) => (
                    <Textarea
                      name="evidenceNote"
                      rows={4}
                      maxLength={4000}
                      defaultValue={existingEvidence?.note ?? ""}
                      {...c}
                    />
                  )}
                </FormField>
                <FormField
                  id={`links-${taskId}`}
                  label="Links to the finished work"
                  hint="One web address per line (https://…). Optional if you wrote a note or attached a file."
                >
                  {(c) => (
                    <Textarea
                      name="evidenceLinks"
                      rows={3}
                      defaultValue={(existingEvidence?.links ?? []).join("\n")}
                      {...c}
                    />
                  )}
                </FormField>
              </>
            ) : (
              <FormField id={`note-${taskId}`} label="Reason" required>
                {(c) => (
                  <Textarea name="note" rows={3} maxLength={2000} required minLength={3} {...c} />
                )}
              </FormField>
            )}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={move.to === "cancelled" ? "destructive" : "default"}
              disabled={pending}
            >
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {move.label}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
