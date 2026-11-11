import { describe, expect, it } from "vitest";
import { TTL_MS, createState, verifyState } from "./oauth-state";

const SECRET = "s".repeat(40);
const input = { userId: "u1", clientId: "c1", provider: "gohighlevel", write: false };

describe("oauth state", () => {
  it("round-trips and carries the nonce", () => {
    const { state, nonce } = createState(SECRET, input, 1000);
    expect(verifyState(SECRET, state, 2000)).toMatchObject({ ...input, nonce });
  });
  it("rejects tampering, the wrong secret, expiry and garbage", () => {
    const { state } = createState(SECRET, input, 1000);
    const [payload, sig] = state.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...input, userId: "attacker", nonce: "n", exp: 9e15 }),
    ).toString("base64url");
    expect(verifyState(SECRET, `${forged}.${sig}`, 2000)).toBeNull();
    expect(verifyState("x".repeat(40), state, 2000)).toBeNull();
    expect(verifyState(SECRET, state, 1000 + TTL_MS + 1)).toBeNull();
    for (const bad of [null, undefined, "", "abc", `${payload}`, `${payload}.${sig}.extra`])
      expect(verifyState(SECRET, bad, 2000)).toBeNull();
  });
  it("gives every flow its own nonce", () => {
    expect(createState(SECRET, input).nonce).not.toBe(createState(SECRET, input).nonce);
  });
});
