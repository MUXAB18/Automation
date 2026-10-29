"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { FormMessage } from "@/components/form-message";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { resetPasswordAction, type ResetState } from "./actions";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(resetPasswordAction, {});
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">New password</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          placeholder="At least 12 characters"
          minLength={12}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm">Confirm password</Label>
        <PasswordInput id="confirm" name="confirm" autoComplete="new-password" minLength={12} />
      </div>
      <FormMessage error={state.error} />
      <Button type="submit" disabled={pending} className="h-11 w-full">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Change password
      </Button>
    </form>
  );
}
