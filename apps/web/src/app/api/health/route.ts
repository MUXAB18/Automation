import { pingDatabase } from "@automation/db";

export const dynamic = "force-dynamic";

/**
 * Liveness + database check for Docker and load balancers. Public and unauthenticated, so it reveals
 * nothing but ok/error; never cached.
 */
export async function GET() {
  const db = await pingDatabase();
  return Response.json(
    { status: db.ok ? "ok" : "error" },
    { status: db.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
