import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for stored third-party tokens.
 *
 * Format: `v1.<keyId>.<iv>.<authTag>.<ciphertext>` (base64url parts). `keyId` identifies which key
 * encrypted the value, so a retired key can stay in the keyring for decrypting until rows are
 * re-encrypted. `context` (e.g. `clientId:google`) is bound as authenticated data, so a
 * ciphertext copied to another client or provider fails to decrypt.
 */

const VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}

function parseKey(raw: string): Buffer {
  const value = raw.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (key.length !== KEY_BYTES) {
    throw new CryptoError(`Encryption key must be ${KEY_BYTES} bytes (64 hex chars or base64)`);
  }
  return key;
}

const keyIdOf = (key: Buffer) => createHash("sha256").update(key).digest("hex").slice(0, 8);

export type TokenCipher = {
  encrypt(plaintext: string, context: string): string;
  decrypt(payload: string, context: string): string;
  /** True when the value was encrypted with a key other than the current one. */
  needsRotation(payload: string): boolean;
};

/** `current` encrypts; `previous` keys are only used to decrypt (rotation). */
export function createTokenCipher(current: string, previous: readonly string[] = []): TokenCipher {
  const currentKey = parseKey(current);
  const currentId = keyIdOf(currentKey);
  const keyring = new Map<string, Buffer>([[currentId, currentKey]]);
  for (const raw of previous) {
    const key = parseKey(raw);
    keyring.set(keyIdOf(key), key);
  }

  const split = (payload: string) => {
    const parts = payload.split(".");
    if (parts.length !== 5 || parts[0] !== VERSION)
      throw new CryptoError("Unrecognised ciphertext format");
    return parts as [string, string, string, string, string];
  };

  return {
    encrypt(plaintext, context) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", currentKey, iv);
      cipher.setAAD(Buffer.from(context));
      const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return [
        VERSION,
        currentId,
        ...[iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")),
      ].join(".");
    },
    decrypt(payload, context) {
      const [, keyId, iv, tag, data] = split(payload);
      const key = keyring.get(keyId);
      if (!key) throw new CryptoError("Ciphertext was encrypted with an unknown key");
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
        decipher.setAAD(Buffer.from(context));
        decipher.setAuthTag(Buffer.from(tag, "base64url"));
        return Buffer.concat([
          decipher.update(Buffer.from(data, "base64url")),
          decipher.final(),
        ]).toString("utf8");
      } catch {
        // Never include the underlying error: it can hint at key or data details.
        throw new CryptoError("Could not decrypt value (wrong key, context, or tampered data)");
      }
    },
    needsRotation(payload) {
      return split(payload)[1] !== currentId;
    },
  };
}
