import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CryptoError, createTokenCipher } from "./crypto";

const keyA = randomBytes(32).toString("base64");
const keyB = randomBytes(32).toString("hex");

describe("createTokenCipher", () => {
  it("round-trips and never stores plaintext", () => {
    const cipher = createTokenCipher(keyA);
    const payload = cipher.encrypt("refresh-token-123", "c1:google");
    expect(payload).not.toContain("refresh-token-123");
    expect(cipher.decrypt(payload, "c1:google")).toBe("refresh-token-123");
  });

  it("uses a fresh IV each time", () => {
    const cipher = createTokenCipher(keyA);
    expect(cipher.encrypt("x", "c")).not.toBe(cipher.encrypt("x", "c"));
  });

  it("rejects a different context (ciphertext moved to another client)", () => {
    const cipher = createTokenCipher(keyA);
    const payload = cipher.encrypt("secret", "c1:google");
    expect(() => cipher.decrypt(payload, "c2:google")).toThrow(CryptoError);
  });

  it("rejects tampered data and malformed input", () => {
    const cipher = createTokenCipher(keyA);
    const parts = cipher.encrypt("secret", "c").split(".");
    parts[4] = Buffer.from("tampered").toString("base64url");
    expect(() => cipher.decrypt(parts.join("."), "c")).toThrow(CryptoError);
    expect(() => cipher.decrypt("garbage", "c")).toThrow(CryptoError);
  });

  it("rejects a wrong key", () => {
    const payload = createTokenCipher(keyA).encrypt("secret", "c");
    expect(() => createTokenCipher(keyB).decrypt(payload, "c")).toThrow(/unknown key/);
  });

  it("decrypts old values with a previous key and flags them for rotation", () => {
    const old = createTokenCipher(keyA).encrypt("secret", "c");
    const rotated = createTokenCipher(keyB, [keyA]);
    expect(rotated.decrypt(old, "c")).toBe("secret");
    expect(rotated.needsRotation(old)).toBe(true);
    expect(rotated.needsRotation(rotated.encrypt("secret", "c"))).toBe(false);
  });

  it("validates key length", () => {
    expect(() => createTokenCipher("too-short")).toThrow(CryptoError);
  });
});
