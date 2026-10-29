import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { clientIdsWith, getAccessMap, listAgenciesWith } from "@automation/db";
import { SECTIONS, type SectionKey } from "./nav";
import type { SessionActor } from "./session";

/**
 * Sections this user may open, computed from their real permissions (once per request).
 * Used for the sidebar AND by every page through requireSection, so the menu and the pages agree.
 */
export const getVisibleSections = cache(async (actor: SessionActor): Promise<SectionKey[]> => {
  const map = await getAccessMap(actor);
  const keys: SectionKey[] = [];
  for (const s of SECTIONS) {
    if (s.agencyPermission) {
      if ((await listAgenciesWith(actor, s.agencyPermission)).length > 0) keys.push(s.key);
    } else if (s.permission === null || clientIdsWith(map, s.permission).length > 0) {
      keys.push(s.key);
    }
  }
  return keys;
});

/** First line of every section page after requireActor(): 404 unless the user may use the section. */
export async function requireSection(actor: SessionActor, key: SectionKey): Promise<void> {
  if (!(await getVisibleSections(actor)).includes(key)) notFound();
}
