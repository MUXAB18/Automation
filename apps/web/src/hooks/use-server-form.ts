"use client";

import { useState, useTransition } from "react";
import type { FormState } from "@/lib/action-state";

/**
 * Submit a form to a server action WITHOUT React clearing the fields afterwards. (A plain
 * `<form action>` resets the form when the action finishes, which would wipe a long form after a
 * validation error.) Redirects thrown by the action still work.
 */
export function useServerForm(action: (prev: FormState, formData: FormData) => Promise<FormState>) {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    start(async () => {
      setState(await action({}, data));
    });
  };
  return { state, pending, onSubmit };
}
