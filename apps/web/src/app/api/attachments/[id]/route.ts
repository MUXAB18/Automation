import { NotFoundError, getAttachmentForDownload } from "@automation/db";
import { getSession } from "@/lib/session";
import { readStoredFile } from "@/lib/storage";

/**
 * Download a task attachment. The file is only ever served here, after the task it belongs to has been
 * authorised for this user (a missing session, a task in another tenant and a deleted file all answer
 * 404, so nothing can be probed). Served as a download with sniffing and scripting switched off.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Not found", { status: 404 });
  const { id } = await params;
  try {
    const file = await getAttachmentForDownload(
      { userId: session.user.id, isAdmin: session.user.isAdmin === true },
      id,
    );
    const bytes = await readStoredFile(file.storageKey);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError || (error as { code?: string }).code === "ENOENT")
      return new Response("Not found", { status: 404 });
    throw error;
  }
}
