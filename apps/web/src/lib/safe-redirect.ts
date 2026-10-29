/**
 * Only same-site relative paths are allowed as post-login destinations; anything else (absolute URLs,
 * protocol-relative `//host`, backslash tricks, control characters) falls back to the dashboard.
 */
export function safeRedirectPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  return value;
}
