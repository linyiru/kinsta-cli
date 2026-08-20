import type {
  AnalyticsDispersionEntry,
  AnalyticsResponse,
  AnalyticsResponseCodeEntry,
  AnalyticsSeries,
  AnalyticsTopEntry,
  AnalyticsTopIpEntry,
  UsageSummary,
} from "./types.ts";
import { table } from "./util.ts";

export type MetricShape =
  | "timeseries"
  | "top"
  | "top-ip"
  | "response-codes"
  | "dispersion"
  | "usage";

export type MetricUnit = "bytes" | "count";

export interface MetricDef {
  /** CLI name and JSON key. */
  name: string;
  label: string;
  shape: MetricShape;
  /** Endpoint path segment under `analytics/` (absent for usage). */
  path?: string;
  unit: MetricUnit;
}

export const METRICS: readonly MetricDef[] = [
  { name: "usage", label: "Plan usage (this month)", shape: "usage", unit: "count" },
  { name: "visits", label: "Visits", shape: "timeseries", path: "visits", unit: "count" },
  {
    name: "bandwidth",
    label: "Server bandwidth",
    shape: "timeseries",
    path: "bandwidth",
    unit: "bytes",
  },
  {
    name: "cdn-bandwidth",
    label: "CDN bandwidth",
    shape: "timeseries",
    path: "cdn-bandwidth",
    unit: "bytes",
  },
  {
    name: "disk-space",
    label: "Disk space",
    shape: "timeseries",
    path: "diskspace",
    unit: "bytes",
  },
  {
    name: "response-codes",
    label: "Response codes",
    shape: "response-codes",
    path: "response-codes",
    unit: "count",
  },
  {
    name: "top-countries",
    label: "Top countries",
    shape: "top",
    path: "top-countries",
    unit: "count",
  },
  { name: "top-cities", label: "Top cities", shape: "top", path: "top-cities", unit: "count" },
  {
    name: "top-client-ips",
    label: "Top client IPs",
    shape: "top-ip",
    path: "top-client-ips",
    unit: "count",
  },
  {
    name: "top-referrers",
    label: "Top referrers",
    shape: "top",
    path: "top-referrers",
    unit: "count",
  },
  {
    name: "top-browsers",
    label: "Top browsers",
    shape: "top",
    path: "top-browsers",
    unit: "count",
  },
  {
    name: "top-user-agents",
    label: "Top user agents",
    shape: "top",
    path: "top-uas",
    unit: "count",
  },
  { name: "top-asns", label: "Top ASNs", shape: "top", path: "top-asns", unit: "count" },
  { name: "top-hosts", label: "Top hosts", shape: "top", path: "top-hosts", unit: "count" },
  {
    name: "visits-dispersion",
    label: "Visit dispersion",
    shape: "dispersion",
    path: "visits-dispersion",
    unit: "count",
  },
] as const;

export const METRIC_NAMES: readonly string[] = METRICS.map((m) => m.name);

const METRICS_BY_NAME = new Map(METRICS.map((m) => [m.name, m]));

/** Metrics shown when the user does not pass `--metric`. */
export const DEFAULT_METRICS: readonly string[] = [
  "usage",
  "visits",
  "bandwidth",
  "cdn-bandwidth",
  "response-codes",
  "top-countries",
];

export class UnknownMetricError extends Error {
  constructor(public readonly unknown: string[]) {
    super(
      `Unknown metric(s): ${unknown.join(", ")}.\n` +
        `Available: ${METRIC_NAMES.join(", ")} (or "all").`,
    );
    this.name = "UnknownMetricError";
  }
}

/** Resolve requested metric names to definitions; supports "all" and defaults. */
export function resolveMetrics(selected?: string[]): MetricDef[] {
  const names = selected && selected.length > 0 ? selected : [...DEFAULT_METRICS];
  if (names.includes("all")) return [...METRICS];

  const unknown = names.filter((n) => !METRICS_BY_NAME.has(n));
  if (unknown.length > 0) throw new UnknownMetricError(unknown);

  const seen = new Set<string>();
  const out: MetricDef[] = [];
  for (const n of names) {
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(METRICS_BY_NAME.get(n) as MetricDef);
  }
  return out;
}

export interface TimeRangeInput {
  span?: string;
  from?: string;
  to?: string;
}

export const VALID_SPANS: readonly string[] = ["24_hours", "7_days", "30_days", "60_days"];
export const DEFAULT_SPAN = "7_days";

/** Build the analytics query window: a custom `from`/`to` pair, else `time_span`. */
export function buildTimeRange(opts: TimeRangeInput): Record<string, string> {
  if (opts.from && opts.to) return { from: opts.from, to: opts.to };
  return { time_span: opts.span ?? DEFAULT_SPAN };
}

function parseNum(value: string | number | undefined): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[i]}`;
}

export function formatValue(unit: MetricUnit, value: number): string {
  return unit === "bytes" ? formatBytes(value) : Math.round(value).toLocaleString("en-US");
}

function formatWhen(key: string): string {
  return key
    .replace("T", " ")
    .replace(/\.\d+Z$/, "")
    .replace(/Z$/, "");
}

/** Sum a timeseries: trust the reported `total`, fall back to the dataset. */
export function seriesTotal(resp: AnalyticsResponse<AnalyticsSeries>): number {
  const series = resp.data[0];
  if (!series) return 0;
  if (typeof series.total === "number" && series.total > 0) return series.total;
  return series.dataset.reduce((sum, p) => sum + parseNum(p.value), 0);
}

export function renderUsage(usage: UsageSummary): string {
  return table(
    [
      ["Visits", formatValue("count", usage.visits)],
      ["Server bandwidth", formatBytes(usage.bandwidth)],
      ["CDN bandwidth", formatBytes(usage.cdnBandwidth)],
    ],
    ["THIS MONTH", "VALUE"],
  );
}

/** Render one non-usage metric response into a printable block. */
export function renderMetric(
  def: MetricDef,
  resp: AnalyticsResponse<unknown>,
  topN: number,
): string {
  switch (def.shape) {
    case "timeseries": {
      const series = (resp.data as AnalyticsSeries[])[0];
      if (!series || series.dataset.length === 0) return "  (no data)";
      const rows = series.dataset.map((p) => [
        formatWhen(p.key),
        formatValue(def.unit, parseNum(p.value)),
      ]);
      const total = formatValue(def.unit, seriesTotal(resp as AnalyticsResponse<AnalyticsSeries>));
      return `${table(rows, ["WHEN", "VALUE"])}\n  total: ${total}`;
    }
    case "top": {
      const entries = (resp.data as AnalyticsTopEntry[]).slice(0, topN);
      if (entries.length === 0) return "  (no data)";
      const rows = entries.map((e, i) => [
        String(i + 1),
        e.name,
        formatValue("count", parseNum(e.views)),
      ]);
      return table(rows, ["#", "NAME", "VIEWS"]);
    }
    case "top-ip": {
      const entries = (resp.data as AnalyticsTopIpEntry[]).slice(0, topN);
      if (entries.length === 0) return "  (no data)";
      const rows = entries.map((e, i) => [
        String(i + 1),
        e.ip,
        formatValue("count", parseNum(e.value)),
      ]);
      return table(rows, ["#", "IP", "REQUESTS"]);
    }
    case "response-codes": {
      const entries = resp.data as AnalyticsResponseCodeEntry[];
      if (entries.length === 0) return "  (no data)";
      const rows = entries
        .map((e) => ({
          code: e.response_code,
          total: e.data.reduce((sum, p) => sum + parseNum(p.value), 0),
        }))
        .toSorted((a, b) => a.code.localeCompare(b.code))
        .map((e) => [e.code, formatValue("count", e.total)]);
      return table(rows, ["CODE", "REQUESTS"]);
    }
    case "dispersion": {
      const entries = resp.data as AnalyticsDispersionEntry[];
      if (entries.length === 0) return "  (no data)";
      const rows = entries.map((e) => {
        const avg = e.dataset.length
          ? e.dataset.reduce((sum, p) => sum + parseNum(p.percent), 0) / e.dataset.length
          : 0;
        return [e.name, `${avg.toFixed(1)}%`];
      });
      return table(rows, ["SEGMENT", "AVG %"]);
    }
    default:
      return "";
  }
}

/** One-line summary for the fleet-wide `--all` view. */
export function summarizeMetric(def: MetricDef, resp: AnalyticsResponse<unknown>): string {
  switch (def.shape) {
    case "timeseries":
      return `${def.label}=${formatValue(def.unit, seriesTotal(resp as AnalyticsResponse<AnalyticsSeries>))}`;
    case "top": {
      const top = (resp.data as AnalyticsTopEntry[])[0];
      return `${def.label}=${top ? `${top.name}(${formatValue("count", parseNum(top.views))})` : "—"}`;
    }
    case "top-ip": {
      const top = (resp.data as AnalyticsTopIpEntry[])[0];
      return `${def.label}=${top ? `${top.ip}(${formatValue("count", parseNum(top.value))})` : "—"}`;
    }
    case "response-codes": {
      const entries = resp.data as AnalyticsResponseCodeEntry[];
      const sum = (filter: (code: string) => boolean) =>
        entries
          .filter((e) => filter(e.response_code))
          .reduce((s, e) => s + e.data.reduce((a, p) => a + parseNum(p.value), 0), 0);
      const all = sum(() => true);
      const errors = sum((c) => c.startsWith("4") || c.startsWith("5"));
      return `${def.label}=${formatValue("count", errors)} err / ${formatValue("count", all)}`;
    }
    default:
      return def.label;
  }
}

export function summarizeUsage(usage: UsageSummary): string {
  return `visits=${formatValue("count", usage.visits)}  bw=${formatBytes(usage.bandwidth)}  cdn=${formatBytes(usage.cdnBandwidth)}`;
}
