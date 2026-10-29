"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export type ConfirmResult = { error?: string; success?: string } | void;

/**
 * Confirmation before a consequential action. `action` is a server action; `fields` are posted with
 * it (ids are re-authorised on the server, never trusted). The result is reported with a toast.
 */
export function ConfirmDialog({
  triggerLabel,
  triggerVariant = "outline",
  triggerSize = "sm",
  triggerClassName,
  title,
  description,
  confirmLabel,
  destructive = false,
  action,
  fields,
}: {
  triggerLabel: string;
  triggerVariant?: "outline" | "ghost" | "destructive" | "default";
  triggerSize?: "sm" | "default";
  triggerClassName?: string;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  action: (formData: FormData) => Promise<ConfirmResult>;
  fields: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.set(k, v);
    start(async () => {
      const result = await action(data);
      if (result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success((result && result.success) || "Done");
      setOpen(false);
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant={triggerVariant}
          size={triggerSize}
          className={triggerClassName}
        >
          {triggerLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <form onSubmit={submit}>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-6">
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={pending}
            >
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {confirmLabel}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
