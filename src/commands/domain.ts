import pc from "picocolors";
import type { KinstaClient } from "../api.ts";
import { awaitOperation } from "../operation.ts";
import { primaryDomainOf, resolveSite } from "../resolve.ts";
import type { DnsRecord, SiteDomain } from "../types.ts";
import { table } from "../util.ts";

export class DomainNotFoundError extends Error {
  constructor(domain: string, site: string, known: SiteDomain[]) {
    super(
      `${domain} is not a domain of ${site}. ` +
        `Known: ${known.map((d) => d.name).join(", ") || "none"}.`,
    );
    this.name = "DomainNotFoundError";
  }
}

function normalize(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, "");
}

async function findDomain(
  client: KinstaClient,
  envId: string,
  siteName: string,
  domain: string,
): Promise<SiteDomain> {
  const domains = await client.listSiteDomains(envId);
  const wanted = normalize(domain);
  const found = domains.find((d) => d.name.toLowerCase() === wanted);
  if (!found) throw new DomainNotFoundError(wanted, siteName, domains);
  return found;
}

function printRecords(title: string, records: DnsRecord[]): void {
  if (records.length === 0) return;
  console.log(pc.bold(title));
  console.log(
    table(
      records.map((r) => [r.type, r.name, r.value]),
      ["TYPE", "NAME", "VALUE"],
    ),
  );
}

export async function domainListCommand(
  client: KinstaClient,
  query: string,
  opts: { json?: boolean } = {},
): Promise<void> {
  const sites = await client.listSites();
  const { site, env } = resolveSite(sites, query);
  const domains = await client.listSiteDomains(env.id);

  if (opts.json) {
    console.log(JSON.stringify(domains, null, 2));
    return;
  }

  const primary = primaryDomainOf(env);
  console.log(pc.bold(site.name) + pc.dim(` (${env.id})`));
  console.log(
    table(
      domains.map((d) => [
        d.name,
        d.name === primary ? "primary" : "",
        d.uses_cloudflare_dns ? "cloudflare" : "",
        d.id,
      ]),
      ["DOMAIN", "", "DNS", "ID"],
    ),
  );
}

export async function domainRecordsCommand(
  client: KinstaClient,
  query: string,
  domain: string,
  opts: { json?: boolean } = {},
): Promise<void> {
  const sites = await client.listSites();
  const { site, env } = resolveSite(sites, query);
  const found = await findDomain(client, env.id, site.name, domain);
  const records = await client.getDomainRecords(found.id);

  if (opts.json) {
    console.log(JSON.stringify({ domain: found.name, ...records }, null, 2));
    return;
  }

  console.log(pc.bold(found.name) + pc.dim(` on ${site.name}`));
  printRecords("Verification", records.verification_records);
  printRecords("Pointing", records.pointing_records);
  if (records.verification_records.length + records.pointing_records.length === 0) {
    console.log(pc.dim("  no records requested (already verified?)"));
  }
}

export async function domainAddCommand(
  client: KinstaClient,
  query: string,
  domains: string[],
  opts: { noWait?: boolean } = {},
): Promise<void> {
  const sites = await client.listSites();
  const { site, env } = resolveSite(sites, query);
  console.log(pc.bold(site.name) + pc.dim(` (${env.id})`));

  const existing = new Set((await client.listSiteDomains(env.id)).map((d) => d.name));
  const added: string[] = [];
  for (const domain of domains.map(normalize)) {
    if (existing.has(domain)) {
      console.log(pc.yellow("!") + ` ${domain} is already on this site; skipped`);
      continue;
    }
    const operationId = await client.addSiteDomain(env.id, domain);
    if (opts.noWait) {
      console.log(pc.green("✓") + ` add ${domain} queued ` + pc.dim(operationId));
      continue;
    }
    await awaitOperation(client, operationId, `added ${domain}`, {
      intervalMs: 5000,
      maxAttempts: 60,
    });
    added.push(domain);
  }

  // The records are the next thing the operator needs: they go to whoever
  // runs the domain's DNS.
  for (const domain of added) {
    const found = await findDomain(client, env.id, site.name, domain);
    const records = await client.getDomainRecords(found.id);
    console.log();
    console.log(pc.bold(domain));
    printRecords("Verification", records.verification_records);
    printRecords("Pointing", records.pointing_records);
  }
}

export async function domainPrimaryCommand(
  client: KinstaClient,
  query: string,
  domain: string,
  opts: { searchReplace?: boolean; noWait?: boolean } = {},
): Promise<void> {
  const sites = await client.listSites();
  const { site, env } = resolveSite(sites, query);
  const found = await findDomain(client, env.id, site.name, domain);
  const searchReplace = opts.searchReplace ?? true;

  console.log(
    pc.bold(site.name) +
      `: primary ${primaryDomainOf(env) ?? "-"} → ${pc.bold(found.name)}` +
      pc.dim(searchReplace ? " (with search-replace)" : " (no search-replace)"),
  );
  const operationId = await client.changePrimaryDomain(env.id, found.id, searchReplace);
  if (opts.noWait) {
    console.log(pc.green("✓") + ` primary domain change queued ` + pc.dim(operationId));
    return;
  }
  await awaitOperation(client, operationId, "primary domain changed", {
    intervalMs: 5000,
    maxAttempts: 60,
  });
}
