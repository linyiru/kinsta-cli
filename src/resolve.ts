import type { Environment, ResolvedSite, Site } from "./types.ts";

/** The live environment if present, else the first environment. */
export function pickLiveEnv(site: Site): Environment | undefined {
  return site.environments.find((e) => e.name === "live") ?? site.environments[0];
}

/** Best-effort primary domain for an environment. */
export function primaryDomainOf(env: Environment | undefined): string | undefined {
  if (!env) return undefined;
  if (env.primaryDomain?.name) return env.primaryDomain.name;
  const live = env.domains?.find((d) => d.type === "live");
  return live?.name ?? env.domains?.[0]?.name;
}

export class SiteResolutionError extends Error {
  constructor(
    message: string,
    public readonly matches: Site[] = [],
  ) {
    super(message);
    this.name = "SiteResolutionError";
  }
}

/**
 * Resolve a user-supplied query to a single site + environment.
 * Matches (case-insensitive) against site name, display name, and any domain.
 * Exact matches win over substring matches to keep behaviour predictable.
 */
export function resolveSite(sites: Site[], query: string): ResolvedSite {
  const q = query.trim().toLowerCase();

  const exact = sites.filter((site) => {
    if (site.name.toLowerCase() === q) return true;
    if (site.display_name.toLowerCase() === q) return true;
    return site.environments.some((env) => env.domains?.some((d) => d.name.toLowerCase() === q));
  });

  const candidates =
    exact.length > 0
      ? exact
      : sites.filter((site) => {
          if (site.name.toLowerCase().includes(q)) return true;
          if (site.display_name.toLowerCase().includes(q)) return true;
          return site.environments.some((env) =>
            env.domains?.some((d) => d.name.toLowerCase().includes(q)),
          );
        });

  if (candidates.length === 0) {
    throw new SiteResolutionError(`No site matched "${query}".`);
  }
  if (candidates.length > 1) {
    throw new SiteResolutionError(
      `"${query}" matched ${candidates.length} sites; be more specific.`,
      candidates,
    );
  }

  const site = candidates[0] as Site;
  const env = pickLiveEnv(site);
  if (!env) {
    throw new SiteResolutionError(`Site "${site.name}" has no environments.`);
  }
  return { site, env };
}
