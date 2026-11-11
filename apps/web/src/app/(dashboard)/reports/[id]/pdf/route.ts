import { NextResponse } from "next/server";
import { ForbiddenError, NotFoundError, getReport } from "@automation/db";
import { renderReportPdf } from "@automation/reports";
import { getOptionalActor } from "@/lib/session";
import { QUOTAS, consumeUserQuota } from "@/lib/throttle";

export const dynamic = "force-dynamic";

/** PDF export. Authorised exactly like the report page: a client gets it only once approved, and only for their own client. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getOptionalActor();
  if (!actor) return new NextResponse("Sign in first", { status: 401 });
  const { id } = await params;
  try {
    const { view } = await getReport(actor, id);
    // Rendering is CPU-heavy: cap it per person, after authorisation so strangers cannot use up a quota.
    if (
      !(await consumeUserQuota(
        QUOTAS.reportPdf.action,
        actor.userId,
        QUOTAS.reportPdf.limit,
        QUOTAS.reportPdf.windowMs,
      ))
    )
      return new NextResponse("Too many requests", {
        status: 429,
        headers: { "Retry-After": "600" },
      });
    const pdf = await renderReportPdf(view);
    const name = `${view.clientName}-${view.periodStart}-to-${view.periodEnd}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${name}.pdf"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError)
      return new NextResponse("Not found", { status: 404 });
    throw error;
  }
}
