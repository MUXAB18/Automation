"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** A button that runs a server action with fixed fields and reports the result as a toast. */
export function ActionButton({
  action,
  fields,
  children,
  variant = "outline",
  disabled,
}: {
  action: (formData: FormData) => Promise<{ error?: string; success?: string }>;
  fields: Record<string, string>;
  children: React.ReactNode;
  variant?: "outline" | "default" | "ghost";
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          const data = new FormData();
          for (const [k, v] of Object.entries(fields)) data.set(k, v);
          const result = await action(data);
          if (result.error) toast.error(result.error);
          else toast.success(result.success ?? "Done");
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </Button>
  );
}
