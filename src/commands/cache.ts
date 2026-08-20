import pc from "picocolors";
import type { KinstaClient } from "../api.ts";
import { resolveSite } from "../resolve.ts";

export interface CacheClearOptions {
  cdn?: boolean;
  edge?: boolean;
}

export async function cacheClearCommand(
  client: KinstaClient,
  query: string,
  opts: CacheClearOptions = {},
): Promise<void> {
  const sites = await client.listSites();
  const { site, env } = resolveSite(sites, query);

  console.log(pc.bold(site.name) + pc.dim(` (${env.id})`));

  const op = await client.clearCache(env.id);
  console.log(pc.green("✓") + ` site cache clear queued ` + pc.dim(op));

  if (opts.cdn) {
    if (env.cdn_cache_id) {
      const cdnOp = await client.clearCdnCache(env.id, env.cdn_cache_id);
      console.log(pc.green("✓") + ` CDN cache clear queued ` + pc.dim(cdnOp));
    } else {
      console.log(pc.yellow("!") + ` no cdn_cache_id for this environment; skipped CDN`);
    }
  }

  if (opts.edge) {
    const edgeOp = await client.clearEdgeCache(env.id);
    console.log(pc.green("✓") + ` edge cache clear queued ` + pc.dim(edgeOp));
  }
}
