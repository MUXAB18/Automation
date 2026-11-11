import {
  persistGoogleRecords,
  persistProviderRecords,
  persistSeRankingRecords,
  type SyncExecution,
} from "@automation/db";
import type { SyncSink } from "@automation/integrations";

/** Writes normalised provider records to the database and counts what was stored per resource. */
export function createProviderSink(
  execution: SyncExecution,
): SyncSink & { written: Record<string, number> } {
  const written: Record<string, number> = {};
  return {
    written,
    async write(records, { resource }) {
      if (
        execution.providerKey === "google_analytics_4" ||
        execution.providerKey === "google_search_console"
      ) {
        // Google pages mix record kinds (properties, metrics, access problems); each names its own.
        const count = await persistGoogleRecords(
          {
            agencyId: execution.agencyId,
            clientId: execution.clientId,
            accountId: execution.accountId,
            syncRunId: execution.runId,
          },
          records.map((r) => ({ resource: r.resource, externalId: r.externalId, data: r.data })),
        );
        for (const r of records) written[r.resource] = (written[r.resource] ?? 0) + 1;
        return count;
      }
      if (execution.providerKey === "se_ranking") {
        // SE Ranking pages mix record kinds (an audit page also carries issues), so each record names its own.
        const count = await persistSeRankingRecords(
          {
            agencyId: execution.agencyId,
            clientId: execution.clientId,
            accountId: execution.accountId,
            syncRunId: execution.runId,
          },
          records.map((r) => ({ resource: r.resource, externalId: r.externalId, data: r.data })),
        );
        for (const r of records) written[r.resource] = (written[r.resource] ?? 0) + 1;
        return count;
      }
      const count = await persistProviderRecords(
        {
          agencyId: execution.agencyId,
          clientId: execution.clientId,
          accountId: execution.accountId,
          syncRunId: execution.runId,
        },
        resource,
        records.map((r) => ({ resource: r.resource, externalId: r.externalId, data: r.data })),
      );
      written[resource] = (written[resource] ?? 0) + count;
      return count;
    },
  };
}
