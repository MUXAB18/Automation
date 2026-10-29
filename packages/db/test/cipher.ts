import { createTokenCipher } from "@automation/integrations";

/** A cipher with a throwaway key, to produce correctly formatted ciphertext in tests. */
export const createTokenCipherForTests = () =>
  createTokenCipher(Buffer.alloc(32, 7).toString("base64"));
