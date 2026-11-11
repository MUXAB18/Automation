/**
 * Structured logging: one JSON object per line on stdout (info/debug) or stderr (warn/error), which
 * Docker, journald and every log shipper read without configuration.
 *
 * Secrets never reach a log line: values under sensitive keys are replaced, and strings are scrubbed of
 * bearer tokens, database URL passwords, stored-token ciphertext and long opaque tokens. Errors are
 * logged as name + scrubbed message (never the raw object, which can carry request configs or SQL).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|cookie|api[-_]?key|credential|private[-_]?key|ciphertext|signature|session/i;

const SCRUBBERS: Array<[RegExp, string]> = [
  [/\b(Bearer|Token|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]"],
  // postgres://user:password@host, redis://:password@host
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]*):[^\s@/]+@/gi, "$1:[redacted]@"],
  // Stored-token ciphertext (v1.<keyId>.<iv>.<tag>.<data>)
  [/\bv1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[ciphertext]"],
  // Query-string secrets
  [/([?&](?:token|code|key|secret|access_token|refresh_token|password)=)[^&\s]+/gi, "$1[redacted]"],
  // JWT-looking values
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[jwt]"],
];

export function scrub(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SCRUBBERS) out = out.replace(pattern, replacement);
  return out;
}

const MAX_DEPTH = 4;
const MAX_STRING = 2_000;

export function redact(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const clean = scrub(value);
    return clean.length > MAX_STRING ? `${clean.slice(0, MAX_STRING)}…` : clean;
  }
  if (value instanceof Error) return errorFields(value);
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return String(typeof value);
}

export function errorFields(error: unknown): { name: string; message: string; code?: string } {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return {
      name: error.name,
      message: scrub(error.message).slice(0, MAX_STRING),
      ...(typeof code === "string" ? { code } : {}),
    };
  }
  return { name: "NonError", message: scrub(String(error)).slice(0, MAX_STRING) };
}

export type LogFields = Record<string, unknown>;
export type Sink = (level: LogLevel, line: string) => void;

const defaultSink: Sink = (level, line) => {
  (level === "warn" || level === "error" ? process.stderr : process.stdout).write(line + "\n");
};

export type Logger = {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
};

export function createLogger(
  base: LogFields = {},
  options: { level?: LogLevel; sink?: Sink; now?: () => Date } = {},
): Logger {
  const configured = options.level ?? parseLevel(process.env.LOG_LEVEL);
  const sink = options.sink ?? defaultSink;
  const now = options.now ?? (() => new Date());
  const write = (level: LogLevel, msg: string, fields?: LogFields) => {
    if (ORDER[level] < ORDER[configured]) return;
    // Reserved keys come last so a caller cannot overwrite the timestamp or level.
    const entry = {
      ...(redact({ ...base, ...fields }) as Record<string, unknown>),
      time: now().toISOString(),
      level,
      msg: scrub(msg),
    };
    sink(level, JSON.stringify(entry));
  };
  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    child: (fields) => createLogger({ ...base, ...fields }, { level: configured, sink, now }),
  };
}

function parseLevel(value: string | undefined): LogLevel {
  return value === "debug" || value === "info" || value === "warn" || value === "error"
    ? value
    : "info";
}

/** Shared logger for the service it runs in. Set `service` once at startup via `child`. */
export const logger = createLogger();
