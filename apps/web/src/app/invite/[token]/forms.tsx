"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { FormMessage } from "@/components/form-message";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  acceptInvitationAction,
  createAccountFromInvitationAction,
  type InviteState,
} from "./actions";

export function CreateAccountForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(
    createAccountFromInvitationAction,
    {},
  );
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" value={email} readOnly disabled />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Your name</Label>
        <Input id="name" name="name" autoComplete="name" maxLength={120} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
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
      {state.needsSignIn ? (
        <Link
          href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
          className="text-sm text-primary hover:underline"
        >
          Sign in to accept
        </Link>
      ) : null}
      <Button type="submit" disabled={pending} className="h-11 w-full">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Create account and join
      </Button>
    </form>
  );
}

export function AcceptForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(
    acceptInvitationAction,
    {},
  );
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="token" value={token} />
      <FormMessage error={state.error} />
      <Button type="submit" disabled={pending} className="h-11 w-full">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Accept invitation
      </Button>
    </form>
  );
}
