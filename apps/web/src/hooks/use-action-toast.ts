"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

/** Turns the `{ error?, success? }` result of a useActionState action into a toast, once per result. */
export function useActionToast(state: { error?: string; success?: string } | undefined) {
  const last = useRef(state);
  useEffect(() => {
    if (!state || state === last.current) return;
    last.current = state;
    if (state.error) toast.error(state.error);
    else if (state.success) toast.success(state.success);
  }, [state]);
}
