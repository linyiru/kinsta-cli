import pc from "picocolors";
import type { KinstaClient } from "../api.ts";
import { resolveSite } from "../resolve.ts";

export async function phpRestartCommand(client: KinstaClient, query: string): Promise<void> {
  const sites = await client.listSites();
  const { site, env } = resolveSite(sites, query);

  console.log(pc.bold(site.name) + pc.dim(` (${env.id})`));
  const op = await client.restartPhp(env.id);
  console.log(pc.green("✓") + ` PHP restart queued (clears OPcache) ` + pc.dim(op));
}
