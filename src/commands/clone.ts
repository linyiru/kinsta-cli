import pc from "picocolors";
import type { KinstaClient } from "../api.ts";
import { awaitOperation } from "../operation.ts";
import { pickLiveEnv, primaryDomainOf, resolveSite, SiteResolutionError } from "../resolve.ts";

export interface CloneOptions {
  name: string;
  noWait?: boolean;
}

export class CloneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloneError";
  }
}

export async function cloneSiteCommand(
  client: KinstaClient,
  query: string,
  opts: CloneOptions,
): Promise<void> {
  const displayName = opts.name.trim();
  if (displayName.length === 0) throw new CloneError("--name must not be empty.");

  const sites = await client.listSites();
  const { site, env, matchKind } = resolveSite(sites, query);

  // A clone takes a plan slot and minutes of copying; a substring match could
  // copy a site the operator never looked at.
  if (matchKind !== "exact") {
    throw new SiteResolutionError(
      `"${query}" only matched "${site.name}" as a substring. ` +
        `Cloning needs an exact site name, display name, or domain.`,
    );
  }

  // The new site is found by display name afterwards, so the name must be
  // unique — and a re-run after a slow clone must not start a second copy.
  const taken = sites.find((s) => s.display_name.toLowerCase() === displayName.toLowerCase());
  if (taken) {
    throw new CloneError(`A site named "${taken.display_name}" already exists (${taken.name}).`);
  }

  console.log(
    `Cloning ${pc.bold(site.display_name)} ${pc.dim(`(${site.name}, env ${env.id})`)} ` +
      `→ ${pc.bold(displayName)}`,
  );
  const operationId = await client.cloneSite(env.id, displayName);

  if (opts.noWait) {
    console.log(pc.green("✓") + ` clone queued ` + pc.dim(operationId));
    return;
  }

  await awaitOperation(client, operationId, "clone", { intervalMs: 10_000, maxAttempts: 120 });

  const created = (await client.listSites()).find((s) => s.display_name === displayName);
  if (!created) {
    throw new CloneError(
      `The clone operation finished, but no site named "${displayName}" is listed yet. ` +
        `Check MyKinsta.`,
    );
  }
  const createdEnv = pickLiveEnv(created);
  console.log(`  site    ${pc.bold(created.name)} ${pc.dim(created.id)}`);
  console.log(`  env     ${createdEnv?.id ?? "-"}`);
  console.log(`  domain  ${primaryDomainOf(createdEnv) ?? "-"}`);
}
