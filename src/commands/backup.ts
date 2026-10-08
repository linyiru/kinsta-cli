import pc from "picocolors";
import type { KinstaClient } from "../api.ts";
import { awaitOperation } from "../operation.ts";
import { resolveSite } from "../resolve.ts";

export interface BackupCreateOptions {
  tag?: string;
  noWait?: boolean;
}

export async function backupCreateCommand(
  client: KinstaClient,
  query: string,
  opts: BackupCreateOptions = {},
): Promise<void> {
  const sites = await client.listSites();
  const { site, env } = resolveSite(sites, query);
  console.log(pc.bold(site.name) + pc.dim(` (${env.id})`));

  const operationId = await client.createManualBackup(env.id, opts.tag ?? "");
  if (opts.noWait) {
    console.log(pc.green("✓") + ` manual backup queued ` + pc.dim(operationId));
    return;
  }
  // A backup copies files and the database; minutes, not seconds.
  await awaitOperation(client, operationId, "manual backup", {
    intervalMs: 10_000,
    maxAttempts: 90,
  });
}
