"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { reassignAllAction } from "@/app/(dashboard)/tasks/actions";
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
import { NativeSelect } from "@/components/ui/native-select";

/** Hand all of one person's open tasks to someone else (leave, departure). The server skips what it must. */
export function ReassignDialog({
  fromUserId,
  fromName,
  people,
}: {
  fromUserId: string;
  fromName: string;
  people: { userId: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const targets = people.filter((p) => p.userId !== fromUserId);
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={targets.length === 0}>
          Reassign
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            start(async () => {
              const result = await reassignAllAction(data);
              if (result.error) toast.error(result.error);
              else {
                toast.success(result.success ?? "Done");
                setOpen(false);
              }
            });
          }}
        >
          <input type="hidden" name="fromUserId" value={fromUserId} />
          <DialogHeader>
            <DialogTitle>Reassign {fromName}&rsquo;s open tasks</DialogTitle>
            <DialogDescription>
              Every unfinished task assigned to {fromName} moves to the person you choose, on the
              clients where you manage assignments. Tasks in progress go back to
              &ldquo;Assigned&rdquo; so the new person starts them. Finished tasks stay where they
              are.
            </DialogDescription>
          </DialogHeader>
          <div className="my-5">
            <FormField id={`to-${fromUserId}`} label="New assignee" required>
              {(c) => (
                <NativeSelect name="toUserId" defaultValue="" required {...c}>
                  <option value="" disabled>
                    Choose a person
                  </option>
                  {targets.map((p) => (
                    <option key={p.userId} value={p.userId}>
                      {p.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
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
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Reassign tasks
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
