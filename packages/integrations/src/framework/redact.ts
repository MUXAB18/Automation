/** Strip anything secret-looking from text before it is logged or stored. Defence in depth: safe messages are already fixed strings. */
const PATTERNS: [RegExp, string][] = [
  [/(authorization["':=\s]+)(bearer|token|basic)?\s*[A-Za-z0-9._~+/=-]{6,}/gi, "$1[redacted]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, "Bearer [redacted]"],
  [
    /\b(access_token|refresh_token|client_secret|api_?key|apikey|token|password|secret)=([^&\s]+)/gi,
    "$1=[redacted]",
  ],
  [
    /("(?:access_token|refresh_token|client_secret|api_?key|token|password|secret)"\s*:\s*)"[^"]*"/gi,
    '$1"[redacted]"',
  ],
  [/\bv1\.[0-9a-f]{8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted]"],
];

export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) if (secret.length >= 6) out = out.split(secret).join("[redacted]");
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out;
}
