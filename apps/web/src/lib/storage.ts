import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * File storage for task attachments. This is the LOCAL driver: files live on this server's disk under
 * UPLOAD_DIR (default `.data/uploads`, git-ignored), named by a random id, never by the user's file
 * name. For production behind several servers swap this module for object storage (S3-compatible) with
 * the same three functions; nothing else changes. Files are only ever served through an authorised route.
 */
const root = () =>
  path.resolve(process.env.UPLOAD_DIR ?? path.join(process.cwd(), ".data", "uploads"));

const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function filePath(storageKey: string): string {
  // The key must be one of our random ids: no separators, no "..", nothing to escape the folder.
  if (!KEY.test(storageKey)) throw new Error("Invalid storage key");
  return path.join(root(), storageKey.slice(0, 2), storageKey);
}

export async function saveFile(bytes: Uint8Array): Promise<{ storageKey: string; sha256: string }> {
  const storageKey = randomUUID();
  const target = filePath(storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
  return { storageKey, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export const readStoredFile = (storageKey: string) => readFile(filePath(storageKey));

export async function deleteStoredFile(storageKey: string): Promise<void> {
  await rm(filePath(storageKey), { force: true });
}
