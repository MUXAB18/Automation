"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

/** Toast for the `{ error?, ok?, message? }` shape used by the client forms (see lib/action-state). */
export function useFormToast(
  state: { error?: string; ok?: boolean; message?: string } | undefined,
) {
  const last = useRef(state);
  useEffect(() => {
    if (!state || state === last.current) return;
    last.current = state;
    if (state.error) toast.error(state.error);
    else if (state.ok) toast.success(state.message ?? "Saved");
  }, [state]);
}
