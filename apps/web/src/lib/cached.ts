import "server-only";
import { cache } from "react";
import { getClient, getProjectDetail } from "@automation/db";
import type { SessionActor } from "./session";

/**
 * Per-request memoised loaders, so a layout and its page do not query the same record twice.
 * React's cache compares arguments by identity, so the actor is passed as primitives.
 */
const client = cache((userId: string, isAdmin: boolean, id: string) =>
  getClient({ userId, isAdmin }, id),
);
const project = cache((userId: string, isAdmin: boolean, id: string) =>
  getProjectDetail({ userId, isAdmin }, id),
);

export const loadClient = (actor: SessionActor, id: string) =>
  client(actor.userId, actor.isAdmin, id);
export const loadProject = (actor: SessionActor, id: string) =>
  project(actor.userId, actor.isAdmin, id);
