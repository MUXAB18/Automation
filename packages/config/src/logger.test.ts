import { describe, expect, it } from "vitest";
import { createLogger, redact, scrub, type LogLevel } from "./logger";

function capture(level: LogLevel = "debug") {
  const lines: Array<{ level: LogLevel; entry: Record<string, unknown> }> = [];
  const log = createLogger(
    { service: "test" },
    {
      level,
      now: () => new Date("2026-01-01T00:00:00Z"),
      sink: (l, line) =>
        lines.push({ level: l, entry: JSON.parse(line) as Record<string, unknown> }),
    },
  );
  return { log, lines };
}

describe("logger", () => {
  it("writes one JSON object per line with time, level and message", () => {
    const { log, lines } = capture();
    log.info("hello", { clientId: "c1" });
    expect(lines[0]!.entry).toMatchObject({
      time: "2026-01-01T00:00:00.000Z",
      level: "info",
      msg: "hello",
      service: "test",
      clientId: "c1",
    });
  });

  it("skips levels below the configured one", () => {
    const { log, lines } = capture("warn");
    log.info("quiet");
    log.error("loud");
    expect(lines.map((l) => l.entry.msg)).toEqual(["loud"]);
  });

  it("does not let fields overwrite the reserved keys", () => {
    const { log, lines } = capture();
    log.info("real", { level: "debug", msg: "fake", time: "x" });
    expect(lines[0]!.entry).toMatchObject({ level: "info", msg: "real" });
  });

  it("redacts values under sensitive keys, at any depth", () => {
    const out = redact({
      password: "hunter2",
      nested: { accessToken: "abc", Authorization: "Bearer zzzzzzzzzzzz", fine: "ok" },
      list: [{ apiKey: "k" }],
    }) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toMatch(/hunter2|zzzzzzzz|"k"/);
    expect((out.nested as Record<string, unknown>).fine).toBe("ok");
  });

  it("scrubs secrets that appear inside strings", () => {
    const text = scrub(
      "failed postgresql://app:s3cretpw@db:5432/x with Bearer abcdefghijklmnop and https://x/cb?code=SECRETCODE&state=1 ct v1.k1.aaaa.bbbb.cccc",
    );
    expect(text).not.toMatch(/s3cretpw|abcdefghijklmnop|SECRETCODE|aaaa/);
    expect(text).toContain("state=1");
  });

  it("logs errors as name and scrubbed message only", () => {
    const { log, lines } = capture();
    const error = Object.assign(new Error("connect postgres://u:pw123456@h/db failed"), {
      code: "ECONNREFUSED",
      config: { headers: { Authorization: "Bearer topsecrettoken" } },
    });
    log.error("job failed", { error });
    const text = JSON.stringify(lines[0]!.entry);
    expect(text).toContain("ECONNREFUSED");
    expect(text).not.toMatch(/pw123456|topsecrettoken|config/);
  });

  it("child loggers add fields", () => {
    const { log, lines } = capture();
    log.child({ queue: "sync" }).info("tick");
    expect(lines[0]!.entry).toMatchObject({ service: "test", queue: "sync" });
  });
});
