import pc from "picocolors";
import type { KinstaClient } from "../api.ts";
import {
  buildTimeRange,
  DEFAULT_SPAN,
  type MetricDef,
  renderMetric,
  renderUsage,
  resolveMetrics,
  summarizeMetric,
  summarizeUsage,
  VALID_SPANS,
} from "../analytics.ts";
import { pickLiveEnv, primaryDomainOf, resolveSite } from "../resolve.ts";
import type { AnalyticsResponse, UsageSummary } from "../types.ts";

export interface AnalyticsOptions {
  metric?: string[];
  span?: string;
  from?: string;
  to?: string;
  top?: number;
  json?: boolean;
  all?: boolean;
  fetch?: typeof globalThis.fetch;
}

export class AnalyticsUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyticsUsageError";
  }
}

interface SiteTarget {
  name: string;
  siteId: string;
  envId: string;
}

function validateSpan(span: string | undefined): void {
  if (span && !VALID_SPANS.includes(span)) {
    throw new AnalyticsUsageError(
      `Invalid --span "${span}". Choose one of: ${VALID_SPANS.join(", ")}.`,
    );
  }
}

/** Fetch every requested metric for one site, keyed by metric name. */
async function fetchMetrics(
  client: KinstaClient,
  target: SiteTarget,
  metrics: MetricDef[],
  range: Record<string, string>,
): Promise<Record<string, AnalyticsResponse<unknown> | UsageSummary>> {
  const out: Record<string, AnalyticsResponse<unknown> | UsageSummary> = {};
  for (const def of metrics) {
    if (def.shape === "usage") {
      out[def.name] = await client.getUsage(target.siteId);
    } else {
      out[def.name] = await client.getAnalytics(target.envId, def.path as string, range);
    }
  }
  return out;
}

export async function analyticsCommand(
  client: KinstaClient,
  query: string | undefined,
  opts: AnalyticsOptions = {},
): Promise<void> {
  validateSpan(opts.span);
  const metrics = resolveMetrics(opts.metric);
  const range = buildTimeRange(opts);
  const topN = opts.top && opts.top > 0 ? opts.top : 10;
  const window = opts.from && opts.to ? `${opts.from}..${opts.to}` : (opts.span ?? DEFAULT_SPAN);

  const sites = await client.listSites();

  if (opts.all) {
    const targets: SiteTarget[] = [];
    for (const site of sites) {
      const env = pickLiveEnv(site);
      if (env && primaryDomainOf(env)) {
        targets.push({ name: site.name, siteId: site.id, envId: env.id });
      }
    }

    const collected: Record<string, unknown> = {};
    for (const target of targets) {
      const data = await fetchMetrics(client, target, metrics, range);
      collected[target.name] = data;
      if (!opts.json) {
        const parts = metrics.map((def) =>
          def.shape === "usage"
            ? summarizeUsage(data[def.name] as UsageSummary)
            : summarizeMetric(def, data[def.name] as AnalyticsResponse<unknown>),
        );
        console.log(`${pc.bold(target.name)}  ${pc.dim(parts.join("  "))}`);
      }
    }
    if (opts.json) {
      console.log(
        JSON.stringify({ window, metrics: metrics.map((m) => m.name), sites: collected }, null, 2),
      );
    }
    return;
  }

  if (!query) {
    throw new AnalyticsUsageError("Provide a site name/domain, or use --all for every site.");
  }

  const { site, env } = resolveSite(sites, query);
  const data = await fetchMetrics(
    client,
    { name: site.name, siteId: site.id, envId: env.id },
    metrics,
    range,
  );

  if (opts.json) {
    console.log(JSON.stringify({ site: site.name, env: env.id, window, metrics: data }, null, 2));
    return;
  }

  console.log(pc.bold(site.name) + pc.dim(` (${env.id}) — ${window}`));
  for (const def of metrics) {
    console.log();
    console.log(pc.bold(def.label));
    if (def.shape === "usage") {
      console.log(renderUsage(data[def.name] as UsageSummary));
    } else {
      console.log(renderMetric(def, data[def.name] as AnalyticsResponse<unknown>, topN));
    }
  }
}
