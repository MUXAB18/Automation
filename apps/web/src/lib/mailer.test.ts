import { afterEach, describe, expect, it, vi } from "vitest";
import { sendMail } from "./mailer";

const mail = { to: "a@example.com", subject: "Hi", text: "link: https://app/invite/secret-token" };
const env = (over: Record<string, unknown> = {}) => ({ MAIL_TRANSPORT: "log", ...over }) as never;

afterEach(() => vi.restoreAllMocks());

describe("sendMail", () => {
  it("prints to the console in development", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await sendMail(mail, { env: env(), production: false });
    expect(info).toHaveBeenCalledOnce();
  });

  it("refuses to use the log transport in production (never leaks one-time links to logs)", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(sendMail(mail, { env: env(), production: true })).rejects.toThrow(
      /not allowed in production/,
    );
    expect(info).not.toHaveBeenCalled();
  });

  it("posts to Resend with the API key in a header only", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await sendMail(mail, {
      env: env({ MAIL_TRANSPORT: "resend", EMAIL_API_KEY: "re_key", EMAIL_FROM: "A <a@x.com>" }),
      production: true,
      fetch: fetchMock,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_key");
    expect(String(init.body)).not.toContain("re_key");
  });

  it("requires the Resend settings and does not echo provider responses", async () => {
    await expect(
      sendMail(mail, { env: env({ MAIL_TRANSPORT: "resend" }), production: true }),
    ).rejects.toThrow(/EMAIL_API_KEY/);
    const failing = vi.fn().mockResolvedValue(new Response("secret details", { status: 422 }));
    const error = await sendMail(mail, {
      env: env({ MAIL_TRANSPORT: "resend", EMAIL_API_KEY: "k", EMAIL_FROM: "f@x.com" }),
      production: true,
      fetch: failing,
    }).catch((e: Error) => e);
    expect((error as Error).message).toBe("Email provider rejected the message (422)");
  });
});
