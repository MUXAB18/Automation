"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/states";

/** Catches any failure while rendering a section. The message is generic; details stay in the server log. */
export default function SectionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <ErrorState digest={error.digest} onRetry={reset} />;
}
