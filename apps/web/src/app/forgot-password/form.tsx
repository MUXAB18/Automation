"use client";

import { useActionState } from "react";
import { Loader2, Mail } from "lucide-react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordResetAction, type ForgotState } from "./actions";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<ForgotState, FormData>(
    requestPasswordResetAction,
    {},
  );
  if (state.sent) {
    return (
      <FormMessage success="If that email has an account, a reset link is on its way. It works once and expires in an hour." />
    );
  }
  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <div className="relative">
          <Mail
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            className="pl-9"
            required
          />
        </div>
      </div>
      <FormMessage error={state.error} />
      <Button type="submit" disabled={pending} className="h-11 w-full">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Send reset link
      </Button>
    </form>
  );
}
