import pc from "picocolors";
import type { KinstaClient } from "../api.ts";
import { diagnoseLogs } from "../analyze.ts";
import { pickLiveEnv, primaryDomainOf, resolveSite } from "../resolve.ts";
import { Ssh2Runner, type SshRunner, type SshTarget } from "../ssh.ts";
import type { Environment, Site } from "../types.ts";
import { checkHealth } from "./health.ts";

export interface FixWpRocketOptions {
  all?: boolean;
  dryRun?: boolean;
  force?: boolean;
  runner?: SshRunner;
  fetch?: typeof globalThis.fetch;
}

export interface FixResult {
  name: string;
  envId: string;
  ok: boolean;
  action: string;
  verifiedStatus?: number;
  note?: string;
}

/** Deactivate wp-rocket, drop its advanced-cache.php drop-in, print a marker. */
const REMEDIATION_CMD =
  'cd "$HOME/public" && ' +
  "wp plugin deactivate wp-rocket --skip-plugins --skip-themes 2>&1; " +
  'rm -f "$HOME/public/wp-content/advanced-cache.php"; ' +
  "echo KINSTA_FIX_DONE";

async function confirmWpRocket(client: KinstaClient, env: Environment): Promise<boolean> {
  try {
    const lines = await client.getLogs(env.id, {
      fileName: "error",
      lines: 300,
      search: "PHP Fatal error",
    });
    return diagnoseLogs(lines).issue === "wp-rocket-php8";
  } catch {
    return false;
  }
}

async function fixOne(
  client: KinstaClient,
  site: Site,
  env: Environment,
  opts: FixWpRocketOptions,
): Promise<FixResult> {
  const base = { name: site.name, envId: env.id };

  if (opts.dryRun) {
    return { ...base, ok: true, action: "dry-run (no changes made)" };
  }

  const runner = opts.runner ?? new Ssh2Runner();
  const config = await client.getSshConfig(site.id, env.id);
  const password = await client.getSshPassword(env.id);
  const target: SshTarget = {
    host: config.host,
    port: Number(config.port),
    user: config.user,
    password,
  };

  const ssh = await runner.run(target, REMEDIATION_CMD);
  if (!ssh.stdout.includes("KINSTA_FIX_DONE")) {
    return {
      ...base,
      ok: false,
      action: "ssh remediation failed",
      note: (ssh.stderr || ssh.stdout).trim().split("\n").slice(-1)[0],
    };
  }

  // Clear OPcache so the deactivation takes effect, then flush the page cache.
  await client.restartPhp(env.id);
  await client.clearCache(env.id);

  const domain = primaryDomainOf(env);
  let verifiedStatus: number | undefined;
  if (domain) {
    const [result] = await checkHealth(
      [{ name: site.name, domain, siteId: site.id, envId: env.id }],
      { fetch: opts.fetch, concurrency: 1 },
    );
    verifiedStatus = result?.status;
  }

  const ok = verifiedStatus === undefined || verifiedStatus < 500;
  return {
    ...base,
    ok,
    action: "wp-rocket deactivated, PHP restarted, cache cleared",
    verifiedStatus,
    note: ok ? undefined : "still returning an error after fix",
  };
}

async function selectTargets(
  client: KinstaClient,
  sites: Site[],
  opts: FixWpRocketOptions,
): Promise<Array<{ site: Site; env: Environment }>> {
  const withEnv = sites
    .map((site) => ({ site, env: pickLiveEnv(site) }))
    .filter((x): x is { site: Site; env: Environment } => Boolean(x.env));

  const targets = withEnv
    .map(({ site, env }) => ({
      site,
      env,
      domain: primaryDomainOf(env),
    }))
    .filter((x) => Boolean(x.domain)) as Array<{
    site: Site;
    env: Environment;
    domain: string;
  }>;

  const health = await checkHealth(
    targets.map((t) => ({
      name: t.site.name,
      domain: t.domain,
      siteId: t.site.id,
      envId: t.env.id,
    })),
    { fetch: opts.fetch },
  );
  const broken = new Set(health.filter((h) => h.category === "server_error").map((h) => h.envId));

  const confirmed: Array<{ site: Site; env: Environment }> = [];
  for (const t of targets) {
    if (!broken.has(t.env.id)) continue;
    if (await confirmWpRocket(client, t.env)) {
      confirmed.push({ site: t.site, env: t.env });
    }
  }
  return confirmed;
}

export async function fixWpRocketCommand(
  client: KinstaClient,
  query: string | undefined,
  opts: FixWpRocketOptions = {},
): Promise<FixResult[]> {
  const sites = await client.listSites();

  let targets: Array<{ site: Site; env: Environment }>;
  if (opts.all) {
    console.error(pc.dim("Scanning all sites for the wp-rocket PHP 8 fatal …"));
    targets = await selectTargets(client, sites, opts);
  } else {
    if (!query) {
      throw new Error("Provide a site, or use --all to fix every affected site.");
    }
    const { site, env } = resolveSite(sites, query);
    if (!opts.force && !opts.dryRun) {
      const isWpRocket = await confirmWpRocket(client, env);
      if (!isWpRocket) {
        return [
          {
            name: site.name,
            envId: env.id,
            ok: false,
            action: "skipped",
            note: "no wp-rocket PHP 8 fatal detected; use --force to fix anyway",
          },
        ];
      }
    }
    targets = [{ site, env }];
  }

  if (targets.length === 0) {
    console.log(pc.green("No sites need the wp-rocket fix."));
    return [];
  }

  const results: FixResult[] = [];
  for (const { site, env } of targets) {
    process.stderr.write(pc.dim(`• ${site.name} … `));
    const result = await fixOne(client, site, env, opts);
    results.push(result);
    console.error(result.ok ? pc.green("done") : pc.red("failed"));
  }

  console.log();
  for (const r of results) {
    const status = r.verifiedStatus !== undefined ? ` [${r.verifiedStatus}]` : "";
    const icon = r.ok ? pc.green("✓") : pc.red("✗");
    console.log(`${icon} ${r.name}${status} — ${r.action}${r.note ? pc.dim(` (${r.note})`) : ""}`);
  }
  const okCount = results.filter((r) => r.ok).length;
  console.log(pc.dim(`\n${okCount}/${results.length} succeeded.`));
  return results;
}
