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

/** The delete never ran: a guardrail stopped it, or confirmation failed. */
export class DeleteAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeleteAbortedError";
  }
}

/**
 * The delete ran but the site is still there. Thrown rather than reported so
 * the process exits non-zero and automation cannot treat it as a success.
 */
export class DeleteFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeleteFailedError";
  }
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
  const { site, matchKind } = resolveSite(sites, query);

  // Deletion is irreversible, so `<site>` must name the site outright. Every
  // other command accepts a substring for convenience; here that convenience
  // would let a typo resolve to a site the operator never looked at.
  if (matchKind !== "exact") {
    throw new SiteResolutionError(
      `"${query}" only matched "${site.name}" as a substring. ` +
        `Deletion needs an exact site name, display name, or domain.`,
    );
  }

  // Read the site directly rather than trusting the listing, so the summary
  // below describes current state and not a cached one.
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

  // Confirming is unbounded — an interactive prompt can sit open for as long as
  // the operator takes — so re-read once more here, with nothing between this
  // check and the irreversible call.
  const atDelete = await client.getSite(fresh.id);
  if (atDelete.name !== fresh.name) {
    throw new DeleteAbortedError(
      `Site ${fresh.id} was renamed to "${atDelete.name}" while awaiting confirmation. Aborting.`,
    );
  }

  const operationId = await client.deleteSite(fresh.id);
  console.log(pc.dim(`   operation ${operationId}`));

  if (opts.noWait) {
    console.log(pc.green("✓") + ` delete queued for ${pc.bold(fresh.name)}`);
    return;
  }

  const result = await client.waitForOperation(operationId, { intervalMs: 5000, maxAttempts: 60 });

  // The operation status is not proof either way: a delete that failed can
  // still report a finished operation, and one that timed out may have landed
  // anyway. Whether the site still resolves is the ground truth, so check that
  // regardless of how the polling ended.
  let gone = false;
  try {
    await client.getSite(fresh.id);
  } catch (err) {
    if (err instanceof KinstaApiError && err.status === 404) gone = true;
    else throw err;
  }

  if (!gone) {
    throw new DeleteFailedError(
      result.timedOut
        ? `${fresh.name} still exists and the delete did not finish within the poll window ` +
            `(${result.message}). Re-run to resume, or check MyKinsta.`
        : `${fresh.name} still exists after the delete operation finished ` +
            `(${result.message}). Check MyKinsta.`,
    );
  }

  console.log(pc.green("✓") + ` ${pc.bold(fresh.name)} deleted`);
}
