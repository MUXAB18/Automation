import "server-only";
import { encryptionEnvSchema, loadEnv } from "@automation/config";
import { createTokenCipher, type TokenCipher } from "@automation/integrations";

let cached: TokenCipher | undefined;

/** The credential cipher. Read lazily so pages that never touch credentials do not need the key. */
export function getCipher(): TokenCipher {
  if (!cached) {
    const env = loadEnv(encryptionEnvSchema);
    cached = createTokenCipher(env.ENCRYPTION_KEY, env.ENCRYPTION_KEY_PREVIOUS);
  }
  return cached;
}
