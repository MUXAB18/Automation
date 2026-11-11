"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-reads the server data every few seconds while something (a queued job) is still in progress. */
export function RefreshOnInterval({ seconds = 3 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
