import pLimit from "p-limit";
import pc from "picocolors";
import type { KinstaClient } from "../api.ts";
import { classifyHttpStatus, type HealthCategory } from "../analyze.ts";
import { pickLiveEnv, primaryDomainOf } from "../resolve.ts";
import { table } from "../util.ts";

export interface HealthTarget {
  name: string;
  domain: string;
  siteId: string;
  envId: string;
}

export interface HealthResult extends HealthTarget {
  status: number;
  category: HealthCategory;
}

export interface CheckOptions {
  fetch?: typeof globalThis.fetch;
  concurrency?: number;
  timeoutMs?: number;
  /** Random suffix generator for cache-busting (injectable for tests). */
  nonce?: () => string;
}

/**
 * Probe each target's homepage with a cache-busting query param so that a
 * cached 200 never masks an underlying 500. Network failures map to status 0.
 */
export async function checkHealth(
  targets: HealthTarget[],
  opts: CheckOptions = {},
): Promise<HealthResult[]> {
  const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const limit = pLimit(opts.concurrency ?? 10);
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const nonce = opts.nonce ?? (() => Math.random().toString(36).slice(2));

  return Promise.all(
    targets.map((target) =>
      limit(async (): Promise<HealthResult> => {
        const url = `https://${target.domain}/?kinstahealth=${nonce()}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetchImpl(url, {
            method: "GET",
            redirect: "follow",
            signal: controller.signal,
            headers: { "User-Agent": "kinsta-cli/health" },
          });
          return {
            ...target,
            status: res.status,
            category: classifyHttpStatus(res.status),
          };
        } catch {
          return { ...target, status: 0, category: "unreachable" };
        } finally {
          clearTimeout(timer);
        }
      }),
    ),
  );
}

const CATEGORY_LABEL: Record<HealthCategory, string> = {
  ok: "OK",
  server_error: "SERVER ERROR",
  forbidden: "FORBIDDEN",
  unreachable: "UNREACHABLE",
  other: "OTHER",
};

function colorStatus(result: HealthResult): string {
  const text = result.status === 0 ? "000" : String(result.status);
  switch (result.category) {
    case "ok":
      return pc.green(text);
    case "server_error":
      return pc.red(text);
    case "forbidden":
      return pc.yellow(text);
    case "unreachable":
      return pc.gray(text);
    default:
      return pc.magenta(text);
  }
}

export interface HealthOptions {
  json?: boolean;
  only?: HealthCategory;
  concurrency?: number;
  fetch?: typeof globalThis.fetch;
}

export async function healthCommand(client: KinstaClient, opts: HealthOptions = {}): Promise<void> {
  const sites = await client.listSites();
  const targets: HealthTarget[] = [];
  for (const site of sites) {
    const env = pickLiveEnv(site);
    const domain = primaryDomainOf(env);
    if (env && domain) {
      targets.push({ name: site.name, domain, siteId: site.id, envId: env.id });
    }
  }

  const results = await checkHealth(targets, {
    fetch: opts.fetch,
    concurrency: opts.concurrency,
  });
  results.sort((a, b) => a.status - b.status || a.name.localeCompare(b.name));

  const filtered = opts.only ? results.filter((r) => r.category === opts.only) : results;

  if (opts.json) {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  const rows = filtered.map((r) => [colorStatus(r), CATEGORY_LABEL[r.category], r.name, r.domain]);
  if (rows.length > 0) {
    console.log(table(rows, ["CODE", "CATEGORY", "NAME", "DOMAIN"]));
  }

  const counts = new Map<HealthCategory, number>();
  for (const r of results) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  const summary = (["ok", "server_error", "forbidden", "unreachable", "other"] as const)
    .filter((c) => counts.has(c))
    .map((c) => `${CATEGORY_LABEL[c]}: ${counts.get(c)}`)
    .join("  ");
  console.log(pc.dim(`\n${results.length} checked — ${summary}`));
}
