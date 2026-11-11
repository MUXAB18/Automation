import type { AdapterRegistry } from "../../framework/registry";
import { createSeRankingAdapter } from "./adapter";

/** SE Ranking needs no platform-level credentials (each client supplies an API key), so it is always live. */
export function registerSeRanking(registry: AdapterRegistry): void {
  registry.registerLive(createSeRankingAdapter());
}
