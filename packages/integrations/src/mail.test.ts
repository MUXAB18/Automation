import { describe, expect, it, vi } from "vitest";
import { createMailer, type MailError } from "./mail";

const msg = {
  to: "a@b.com",
  subject: "S",
  text: "T",
  idempotencyKey: "k1",
  attachments: [
    { filename: "r.pdf", content: new Uint8Array([1, 2, 3]), contentType: "application/pdf" },
  ],
};
const cfg = { transport: "resend" as const, apiKey: "key-secret", from: "reports@x.com" };
const reply = (status: number, body: unknown = {}) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe("mailer", () => {
  it("sends with an idempotency key and the attachment, and returns the provider id", async () => {
    const f = reply(200, { id: "msg-1" });
    expect(await createMailer(cfg, f).send(msg)).toEqual({ messageId: "msg-1" });
    const [, init] = f.mock.calls[0]!;
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("k1");
    expect(JSON.parse(init.body as string).attachments[0]).toMatchObject({
      filename: "r.pdf",
      content: "AQID",
    });
  });
  it("maps rate limits, outages and network errors to retry, and rejections to failed", async () => {
    for (const status of [429, 500, 503])
      await expect(createMailer(cfg, reply(status)).send(msg)).rejects.toMatchObject({
        kind: "retry",
      });
    await expect(createMailer(cfg, reply(422)).send(msg)).rejects.toMatchObject({ kind: "failed" });
    await expect(
      createMailer(cfg, vi.fn().mockRejectedValue(new TypeError("fetch failed"))).send(msg),
    ).rejects.toMatchObject({ kind: "retry" });
  });
  it("never puts the key or the response body in an error", async () => {
    const err = await createMailer(cfg, reply(422, { message: "bad address a@b.com key-secret" }))
      .send(msg)
      .catch((e: unknown) => e);
    expect((err as MailError).message).not.toMatch(/key-secret|a@b\.com/);
  });
  it("the log transport sends nothing and is refused in production", async () => {
    expect((await createMailer({ transport: "log" }).send(msg)).messageId).toBe("log-k1");
    await expect(
      createMailer({ transport: "log", production: true }).send(msg),
    ).rejects.toMatchObject({ kind: "failed" });
  });
  it("requires credentials for the real transport", async () => {
    await expect(createMailer({ transport: "resend" }).send(msg)).rejects.toMatchObject({
      kind: "failed",
    });
  });
});
