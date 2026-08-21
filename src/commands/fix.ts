import pc from "picocolors";
import type { KinstaClient } from "../api.ts";
import { diagnoseLogs, type HealthCategory } from "../analyze.ts";
import { pickLiveEnv, primaryDomainOf, resolveSite } from "../resolve.ts";
import { Ssh2Runner, type SshRunner, type SshTarget } from "../ssh.ts";
import type { Environment, Site } from "../types.ts";
import { WP_ROCKET_REMEDIATION_COMMANDS } from "../wpcli.ts";
import { checkHealth, type HealthResult } from "./health.ts";

export interface FixWpRocketOptions {
  all?: boolean;
  dryRun?: boolean;
  force?: boolean;
  /** Use SSH + WP-CLI instead of the Kinsta API (the default). */
  ssh?: boolean;
  /** Poll each API operation to completion before verifying. */
  wait?: boolean;
  runner?: SshRunner;
  fetch?: typeof globalThis.fetch;
  /** Homepage verification attempts (handles PHP-restart 503 races / stale cache). */
  verifyAttempts?: number;
  /** Delay between verification attempts, in ms. */
  verifyDelayMs?: number;
  /** Injectable sleep (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

export interface FixResult {
  name: string;
  envId: string;
  ok: boolean;
  action: string;
  verifiedStatus?: number;
  category?: HealthCategory;
  note?: string;
}

/**
 * SSH remediation: deactivate wp-rocket, drop its advanced-cache.php drop-in,
 * and print a marker (used only with --ssh).
 */
const SSH_REMEDIATION_CMD =
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

const DEFAULT_VERIFY_ATTEMPTS = 4;
const DEFAULT_VERIFY_DELAY_MS = 3000;

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Verify the homepage the way a real visitor sees it: hit the *cached* URL (no
 * cache-buster) so a stale blank cache entry is caught, and confirm the body is
 * non-empty (a plugin fatal swallowed by an output buffer returns a blank 200).
 * Retries a few times to ride out the PHP-FPM restart window (transient 503),
 * and re-clears the page cache once if it sees a blank response.
 */
async function verifyHomepage(
  client: KinstaClient,
  site: Site,
  env: Environment,
  opts: FixWpRocketOptions,
): Promise<HealthResult | undefined> {
  const domain = primaryDomainOf(env);
  if (!domain) return undefined;
  const target = { name: site.name, domain, siteId: site.id, envId: env.id };
  const attempts = opts.verifyAttempts ?? DEFAULT_VERIFY_ATTEMPTS;
  const delayMs = opts.verifyDelayMs ?? DEFAULT_VERIFY_DELAY_MS;
  const sleep = opts.sleep ?? defaultSleep;

  let last: HealthResult | undefined;
  for (let i = 0; i < attempts; i++) {
    const [result] = await checkHealth([target], {
      fetch: opts.fetch,
      concurrency: 1,
      cacheBust: false,
    });
    last = result;
    if (result?.category === "ok") return result;
    if (i < attempts - 1) {
      // A blank 200 is usually a stale cache entry holding the pre-fix page.
      if (result?.category === "blank") {
        try {
          await client.clearCache(env.id);
        } catch {
          // Best-effort; the next probe is the authoritative check.
        }
      }
      await sleep(delayMs);
    }
  }
  return last;
}

function summarizeVerification(result: HealthResult | undefined): {
  ok: boolean;
  note?: string;
} {
  if (result === undefined) return { ok: true };
  if (result.category === "ok") return { ok: true };
  if (result.category === "blank") {
    return { ok: false, note: "homepage still returns a blank 200 after fix" };
  }
  return { ok: false, note: "still returning an error after fix" };
}

/** Default remediation via the Kinsta API (no SSH; closes the MITM concern). */
async function fixOneApi(
  client: KinstaClient,
  site: Site,
  env: Environment,
  opts: FixWpRocketOptions,
): Promise<FixResult> {
  const base = { name: site.name, envId: env.id };

  const operationIds: string[] = [];
  for (const cmd of WP_ROCKET_REMEDIATION_COMMANDS) {
    operationIds.push(await client.runWpCli(env.id, cmd));
  }
  // Clear OPcache so the deactivation takes effect, then flush the page cache.
  operationIds.push(await client.restartPhp(env.id));
  operationIds.push(await client.clearCache(env.id));

  if (opts.wait) {
    for (const id of operationIds) {
      try {
        await client.waitForOperation(id);
      } catch {
        // Best-effort: the homepage probe below is the authoritative check.
      }
    }
  }

  const verified = await verifyHomepage(client, site, env, opts);
  const { ok, note } = summarizeVerification(verified);
  return {
    ...base,
    ok,
    action: "wp-rocket deactivated (WP_CACHE off), PHP restarted, cache cleared",
    verifiedStatus: verified?.status,
    category: verified?.category,
    note,
  };
}

/** Fallback remediation over SSH + WP-CLI (--ssh). */
async function fixOneSsh(
  client: KinstaClient,
  site: Site,
  env: Environment,
  opts: FixWpRocketOptions,
): Promise<FixResult> {
  const base = { name: site.name, envId: env.id };

  const runner = opts.runner ?? new Ssh2Runner();
  const config = await client.getSshConfig(site.id, env.id);
  const password = await client.getSshPassword(env.id);
  const target: SshTarget = {
    host: config.host,
    port: Number(config.port),
    user: config.user,
    password,
  };

  const ssh = await runner.run(target, SSH_REMEDIATION_CMD);
  if (!ssh.stdout.includes("KINSTA_FIX_DONE")) {
    return {
      ...base,
      ok: false,
      action: "ssh remediation failed",
      note: (ssh.stderr || ssh.stdout).trim().split("\n").slice(-1)[0],
    };
  }

  await client.restartPhp(env.id);
  await client.clearCache(env.id);

  const verified = await verifyHomepage(client, site, env, opts);
  const { ok, note } = summarizeVerification(verified);
  return {
    ...base,
    ok,
    action: "wp-rocket deactivated, PHP restarted, cache cleared (ssh)",
    verifiedStatus: verified?.status,
    category: verified?.category,
    note,
  };
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

  try {
    return opts.ssh
      ? await fixOneSsh(client, site, env, opts)
      : await fixOneApi(client, site, env, opts);
  } catch (err) {
    return {
      ...base,
      ok: false,
      action: opts.ssh ? "ssh remediation failed" : "api remediation failed",
      note: err instanceof Error ? err.message : String(err),
    };
  }
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
