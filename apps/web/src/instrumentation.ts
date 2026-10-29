export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Fail fast at server start if required env vars are missing or invalid.
  const { getWebEnv } = await import("./lib/env");
  getWebEnv();
}
