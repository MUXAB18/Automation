import * as React from "react";
import { cn } from "@/lib/utils";

/** A styled native <select>: accessible and keyboard-friendly everywhere, and posts with plain forms. */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-10 w-full cursor-pointer rounded-lg border border-border bg-card px-3 text-sm shadow-sm transition-shadow focus-visible:border-ring focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}
