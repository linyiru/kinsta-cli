import { createInterface } from "node:readline/promises";
import pc from "picocolors";
import type { KinstaClient } from "../api.ts";
import { KinstaApiError } from "../api.ts";
import { pickLiveEnv, primaryDomainOf, resolveSite, SiteResolutionError } from "../resolve.ts";
import type { Site } from "../types.ts";

export interface DeleteSiteOptions {
  /** Non-interactive confirmation; must equal the resolved site's `name`. */
  confirm?: string;
  /** Print what would be deleted and exit without touching anything. */
  dryRun?: boolean;
  /** Skip polling; return as soon as the API accepts the request. */
  noWait?: boolean;
}

export class DeleteAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeleteAbortedError";
  }
}

/**
 * Deletion is irreversible, so `<site>` must match a site exactly — by name,
 * display name, or one of its domains. Every other command accepts a substring
 * for convenience; here that convenience would let a typo resolve to a site the
 * operator never looked at.
 */
function matchesExactly(site: Site, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (site.name.toLowerCase() === q) return true;
  if (site.display_name.toLowerCase() === q) return true;
  return site.environments.some((env) => env.domains?.some((d) => d.name.toLowerCase() === q));
}

function describe(site: Site): void {
  const env = pickLiveEnv(site);
  const domains = (env?.domains ?? []).map((d) => d.name).filter((n) => !n.startsWith("*."));

  console.log();
  console.log(pc.yellow("⚠  About to permanently delete a Kinsta site."));
  console.log();
  console.log(`   ${"Site".padEnd(14)}${pc.bold(site.name)}  ${pc.dim(`(${site.display_name})`)}`);
  console.log(`   ${"Site ID".padEnd(14)}${pc.dim(site.id)}`);
  console.log(`   ${"Status".padEnd(14)}${site.status ?? "unknown"}`);
  console.log(
    `   ${"Environments".padEnd(14)}${site.environments.map((e) => e.name).join(", ") || "none"}`,
  );
  console.log(`   ${"Primary domain".padEnd(14)}${primaryDomainOf(env) ?? "none"}`);
  if (domains.length > 1) {
    console.log(`   ${"All domains".padEnd(14)}${domains.join(", ")}`);
  }
  console.log();
  console.log(pc.yellow("   Every environment, its database and its files go with it."));
  console.log(pc.yellow("   This cannot be undone. Take a backup first."));
  console.log();
}

async function promptForName(expected: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`   Type ${pc.bold(expected)} to confirm: `);
    return answer.trim() === expected;
  } finally {
    rl.close();
  }
}

export async function deleteSiteCommand(
  client: KinstaClient,
  query: string,
  opts: DeleteSiteOptions = {},
): Promise<void> {
  const sites = await client.listSites();
  const { site } = resolveSite(sites, query);

  if (!matchesExactly(site, query)) {
    throw new SiteResolutionError(
      `"${query}" only matched "${site.name}" as a substring. ` +
        `Deletion needs an exact site name, display name, or domain.`,
    );
  }

  // Re-read the site immediately before deleting: a site id from an older
  // listing may since have been deleted and the name reused.
  const fresh = await client.getSite(site.id);
  if (fresh.name !== site.name) {
    throw new DeleteAbortedError(
      `Site ${site.id} is now named "${fresh.name}", not "${site.name}". Aborting.`,
    );
  }

  describe(fresh);

  if (opts.dryRun) {
    console.log(pc.dim("   --dry-run: nothing was deleted."));
    return;
  }

  // The confirmation string is the *resolved* site name, not whatever the user
  // typed as `<site>`, so they have to read the summary above to answer it.
  if (opts.confirm !== undefined) {
    if (opts.confirm !== fresh.name) {
      throw new DeleteAbortedError(
        `--confirm "${opts.confirm}" does not match the resolved site name "${fresh.name}".`,
      );
    }
  } else if (process.stdin.isTTY) {
    if (!(await promptForName(fresh.name))) {
      throw new DeleteAbortedError("Confirmation did not match; nothing was deleted.");
    }
  } else {
    throw new DeleteAbortedError(
      `Refusing to delete without confirmation on a non-interactive stdin. ` +
        `Pass --confirm ${fresh.name}.`,
    );
  }

  const operationId = await client.deleteSite(fresh.id);
  console.log(pc.dim(`   operation ${operationId}`));

  if (opts.noWait) {
    console.log(pc.green("✓") + ` delete queued for ${pc.bold(fresh.name)}`);
    return;
  }

  const result = await client.waitForOperation(operationId, { intervalMs: 5000, maxAttempts: 60 });
  if (result.timedOut) {
    console.log(pc.yellow("!") + ` delete still running after the poll window — ${result.message}`);
    return;
  }

  // Deleting is asynchronous; only a 404 proves the site is really gone.
  let gone = false;
  try {
    await client.getSite(fresh.id);
  } catch (err) {
    if (err instanceof KinstaApiError && err.status === 404) gone = true;
    else throw err;
  }

  if (gone) {
    console.log(pc.green("✓") + ` ${pc.bold(fresh.name)} deleted`);
  } else {
    console.log(
      pc.yellow("!") + ` operation finished but ${fresh.name} still resolves; check MyKinsta.`,
    );
  }
}
