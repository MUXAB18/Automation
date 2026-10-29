"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Loader2, Mail } from "lucide-react";
import { FormMessage } from "@/components/form-message";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInAction, type LoginState } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signInAction, {});
  return (
    <form action={action} className="flex flex-col gap-5">
      {next ? <input type="hidden" name="next" value={next} /> : null}
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
            placeholder="you@company.com"
            className="pl-9"
            required
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link href="/forgot-password" className="text-xs text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          placeholder="Your password"
        />
      </div>
      <FormMessage error={state.error} />
      <Button type="submit" disabled={pending} className="h-11 w-full">
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Signing in…
          </>
        ) : (
          "Sign in"
        )}
      </Button>
    </form>
  );
}
