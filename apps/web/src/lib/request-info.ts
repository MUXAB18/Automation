import "server-only";
import { headers } from "next/headers";

/**
 * Client IP for audit and throttling. X-Forwarded-For is only trustworthy behind our reverse proxy
 * (Caddy overwrites it); the proxy must be the only way in, see docs/auth.md.
 */
export async function getRequestIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip") || null;
}
