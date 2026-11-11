/**
 * Outgoing email for the worker (report delivery). Two transports: `log` (development: prints, sends nothing, refused
 * in production) and `resend` (HTTP API). The provider call carries an idempotency key, so a retry after a timeout
 * cannot send a second copy. Only safe messages are thrown: response bodies can echo addresses and content.
 */
export type MailAttachment = { filename: string; content: Uint8Array; contentType: string };
export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  attachments?: MailAttachment[];
  idempotencyKey: string;
};
export type MailerConfig = {
  transport: "log" | "resend";
  apiKey?: string;
  from?: string;
  production?: boolean;
};
export type MailOutcomeKind = "retry" | "failed" | "unknown";

export class MailError extends Error {
  constructor(
    public readonly kind: MailOutcomeKind,
    public readonly safeMessage: string,
  ) {
    super(safeMessage);
    this.name = "MailError";
  }
}

export function createMailer(cfg: MailerConfig, fetchImpl: typeof fetch = fetch) {
  return {
    async send(m: MailMessage): Promise<{ messageId: string }> {
      if (cfg.transport === "log") {
        if (cfg.production)
          throw new MailError("failed", "MAIL_TRANSPORT=log is not allowed in production.");
        console.info(
          `\n--- email (dev log transport) ---\nTo: ${m.to}\nSubject: ${m.subject}\nAttachments: ${(m.attachments ?? []).map((a) => `${a.filename} (${a.content.byteLength} bytes)`).join(", ") || "none"}\n---------------------------------\n`,
        );
        return { messageId: `log-${m.idempotencyKey}` };
      }
      if (!cfg.apiKey || !cfg.from)
        throw new MailError(
          "failed",
          "EMAIL_API_KEY and EMAIL_FROM are required for MAIL_TRANSPORT=resend.",
        );
      let res: Response;
      try {
        res = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            authorization: `Bearer ${cfg.apiKey}`,
            "content-type": "application/json",
            "idempotency-key": m.idempotencyKey,
          },
          body: JSON.stringify({
            from: cfg.from,
            to: [m.to],
            subject: m.subject,
            text: m.text,
            attachments: (m.attachments ?? []).map((a) => ({
              filename: a.filename,
              content: Buffer.from(a.content).toString("base64"),
            })),
          }),
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        // The request may or may not have arrived. With the idempotency key a retry is safe.
        throw new MailError("retry", "The mail provider could not be reached.");
      }
      if (res.status === 429 || res.status >= 500)
        throw new MailError("retry", `The mail provider is busy (${res.status}).`);
      if (!res.ok)
        throw new MailError("failed", `The mail provider rejected the message (${res.status}).`);
      const body = (await res.json().catch(() => ({}))) as { id?: string };
      return { messageId: body.id ?? `resend-${m.idempotencyKey}` };
    },
  };
}
