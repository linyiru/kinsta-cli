import pc from "picocolors";
import type { KinstaClient } from "../api.ts";
import { pickLiveEnv, primaryDomainOf } from "../resolve.ts";
import { table } from "../util.ts";

export interface SitesOptions {
  json?: boolean;
}

export async function sitesCommand(client: KinstaClient, opts: SitesOptions = {}): Promise<void> {
  const sites = await client.listSites();
  sites.sort((a, b) => a.name.localeCompare(b.name));

  if (opts.json) {
    console.log(JSON.stringify(sites, null, 2));
    return;
  }

  const rows = sites.map((site) => {
    const env = pickLiveEnv(site);
    return [
      site.name,
      primaryDomainOf(env) ?? "-",
      site.status ?? "-",
      env?.container_info?.php_engine_version ?? "-",
      env?.id ?? "-",
    ];
  });

  console.log(table(rows, ["NAME", "PRIMARY DOMAIN", "STATUS", "PHP", "LIVE ENV ID"]));
  console.log(pc.dim(`\n${sites.length} site(s).`));
}
