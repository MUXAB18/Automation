import "server-only";
import { getWebEnv } from "./env";

export type Mail = { to: string; subject: string; text: string };

type Transport = (mail: Mail) => Promise<void>;
type Options = { fetch?: typeof fetch; env?: ReturnType<typeof getWebEnv>; production?: boolean };

/**
 * Sends email. Fails closed: with the "log" transport in production nothing is sent and an error is
 * thrown, so a misconfigured server can never silently drop invitation or reset emails.
 * Message bodies contain one-time links, so the log transport is development only.
 */
export async function sendMail(mail: Mail, options: Options = {}): Promise<void> {
  const env = options.env ?? getWebEnv();
  const production = options.production ?? process.env.NODE_ENV === "production";
  const doFetch = options.fetch ?? fetch;

  const transports: Record<string, Transport> = {
    log: async (m) => {
      if (production) throw new Error("MAIL_TRANSPORT=log is not allowed in production");
      console.info(
        `\n--- email (dev log transport) ---\nTo: ${m.to}\nSubject: ${m.subject}\n\n${m.text}\n---------------------------------\n`,
      );
    },
    resend: async (m) => {
      if (!env.EMAIL_API_KEY || !env.EMAIL_FROM) {
        throw new Error("EMAIL_API_KEY and EMAIL_FROM are required for MAIL_TRANSPORT=resend");
      }
      const res = await doFetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.EMAIL_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: [m.to],
          subject: m.subject,
          text: m.text,
        }),
      });
      // Never include the response body or key in the error: they can echo the message.
      if (!res.ok) throw new Error(`Email provider rejected the message (${res.status})`);
    },
  };

  await transports[env.MAIL_TRANSPORT]!(mail);
}
