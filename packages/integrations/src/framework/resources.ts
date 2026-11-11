import type { ProviderDescriptor, UnsupportedResource } from "./types";

/**
 * Split a provider's resources into those this account can use and those it cannot, based on the
 * scopes it was granted. Nothing is guessed: a missing scope means "unsupported", with the reason.
 */
export function resolveResources(
  descriptor: Pick<ProviderDescriptor, "resources" | "resourceScopes">,
  granted: readonly string[],
  requested: readonly string[] = descriptor.resources,
): { supported: string[]; unsupported: UnsupportedResource[] } {
  const supported: string[] = [];
  const unsupported: UnsupportedResource[] = [];
  for (const resource of requested) {
    const needed = descriptor.resourceScopes?.[resource] ?? [];
    const missing = needed.filter((s) => !granted.includes(s));
    if (missing.length === 0) supported.push(resource);
    else
      unsupported.push({
        resource,
        reason: `Needs the ${missing.join(", ")} permission, which was not granted.`,
      });
  }
  return { supported, unsupported };
}
