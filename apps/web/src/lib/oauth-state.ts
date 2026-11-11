import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Signed, short-lived `state` for the OAuth round trip. It binds the callback to the person and client
 * that started the flow; the nonce inside is also kept in an httpOnly cookie so a state copied to
 * another browser is useless. Pure functions: the secret and clock are passed in.
 */

export type OAuthState = {
  userId: string;
  clientId: string;
  provider: string;
  nonce: string;
  exp: number;
  write: boolean;
};

const b64 = (b: Buffer) => b.toString("base64url");
const sign = (secret: string, payload: string) =>
  b64(createHmac("sha256", secret).update(payload).digest());

export const TTL_MS = 10 * 60_000;

export function createState(
  secret: string,
  input: Omit<OAuthState, "nonce" | "exp">,
  now = Date.now(),
): { state: string; nonce: string } {
  const nonce = b64(randomBytes(16));
  const payload = b64(Buffer.from(JSON.stringify({ ...input, nonce, exp: now + TTL_MS })));
  return { state: `${payload}.${sign(secret, payload)}`, nonce };
}

export function verifyState(
  secret: string,
  state: string | null | undefined,
  now = Date.now(),
): OAuthState | null {
  if (!state) return null;
  const [payload, signature, extra] = state.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
    if (typeof parsed.exp !== "number" || parsed.exp < now) return null;
    if (!parsed.userId || !parsed.clientId || !parsed.nonce) return null;
    return parsed;
  } catch {
    return null;
  }
}
