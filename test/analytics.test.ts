import { beforeEach, describe, expect, it, vi } from "vitest";
import { KinstaClient } from "../src/api.ts";
import {
  buildTimeRange,
  DEFAULT_METRICS,
  formatBytes,
  formatValue,
  METRICS,
  renderMetric,
  renderUsage,
  resolveMetrics,
  seriesTotal,
  summarizeMetric,
  summarizeUsage,
  UnknownMetricError,
} from "../src/analytics.ts";
import { analyticsCommand } from "../src/commands/analytics.ts";
import type {
  AnalyticsResponse,
  AnalyticsResponseCodeEntry,
  AnalyticsSeries,
  AnalyticsTopEntry,
} from "../src/types.ts";

function makeClient() {
  return new KinstaClient({
    apiKey: "test-key",
    companyId: "company-123",
    baseDelayMs: 1,
    sleep: () => Promise.resolve(),
  });
}

function loggedOutput(): string {
  return (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .map((args) => args.join(" "))
    .join("\n");
}

describe("resolveMetrics", () => {
  it("returns the default set when nothing is selected", () => {
    expect(resolveMetrics().map((m) => m.name)).toEqual([...DEFAULT_METRICS]);
    expect(resolveMetrics([]).map((m) => m.name)).toEqual([...DEFAULT_METRICS]);
  });

  it('expands "all" to every metric', () => {
    expect(resolveMetrics(["all"])).toHaveLength(METRICS.length);
  });

  it("deduplicates while preserving order", () => {
    expect(resolveMetrics(["visits", "visits", "bandwidth"]).map((m) => m.name)).toEqual([
      "visits",
      "bandwidth",
    ]);
  });

  it("throws UnknownMetricError on an unknown metric", () => {
    expect(() => resolveMetrics(["nope"])).toThrow(UnknownMetricError);
  });
});

describe("buildTimeRange", () => {
  it("defaults to a 7-day time span", () => {
    expect(buildTimeRange({})).toEqual({ time_span: "7_days" });
  });

  it("honours an explicit span", () => {
    expect(buildTimeRange({ span: "30_days" })).toEqual({ time_span: "30_days" });
  });

  it("prefers a custom from/to window", () => {
    expect(buildTimeRange({ span: "30_days", from: "2025-08-01", to: "2025-08-20" })).toEqual({
      from: "2025-08-01",
      to: "2025-08-20",
    });
  });

  it("falls back to span when only one bound is given", () => {
    expect(buildTimeRange({ from: "2025-08-01" })).toEqual({ time_span: "7_days" });
  });
});

describe("formatting", () => {
  it("formats bytes in binary units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.00 KiB");
    expect(formatBytes(1073741824)).toBe("1.00 GiB");
  });

  it("formats counts with grouping", () => {
    expect(formatValue("count", 15230)).toBe("15,230");
    expect(formatValue("bytes", 1048576)).toBe("1.00 MiB");
  });
});

describe("seriesTotal", () => {
  it("trusts the reported total", () => {
    const resp: AnalyticsResponse<AnalyticsSeries> = {
      key: "visits",
      data: [{ name: "visits", total: 1234, dataset: [{ key: "d", value: "5" }] }],
    };
    expect(seriesTotal(resp)).toBe(1234);
  });

  it("sums the dataset when no total is present", () => {
    const resp: AnalyticsResponse<AnalyticsSeries> = {
      key: "visits",
      data: [
        {
          name: "visits",
          total: 0,
          dataset: [
            { key: "a", value: "10" },
            { key: "b", value: "20" },
          ],
        },
      ],
    };
    expect(seriesTotal(resp)).toBe(30);
  });
});

describe("renderMetric", () => {
  it("renders a top-N table and respects the limit", () => {
    const resp: AnalyticsResponse<AnalyticsTopEntry> = {
      key: "countries",
      data: [
        { name: "United States", views: "620" },
        { name: "Japan", views: "410" },
        { name: "Germany", views: "204" },
      ],
    };
    const def = METRICS.find((m) => m.name === "top-countries")!;
    const out = renderMetric(def, resp, 2);
    expect(out).toContain("United States");
    expect(out).toContain("620");
    expect(out).not.toContain("Germany");
  });

  it("sorts response codes and sums per code", () => {
    const resp: AnalyticsResponse<AnalyticsResponseCodeEntry> = {
      key: "responseCode",
      data: [
        { response_code: "500", data: [{ key: "d", value: "3" }] },
        {
          response_code: "200",
          data: [
            { key: "d", value: "900" },
            { key: "e", value: "100" },
          ],
        },
      ],
    };
    const def = METRICS.find((m) => m.name === "response-codes")!;
    const out = renderMetric(def, resp, 10);
    expect(out.indexOf("200")).toBeLessThan(out.indexOf("500"));
    expect(out).toContain("1,000");
  });

  it("renders usage as three metered rows", () => {
    const out = renderUsage({ visits: 15230, bandwidth: 1073741824, cdnBandwidth: 536870912 });
    expect(out).toContain("15,230");
    expect(out).toContain("1.00 GiB");
    expect(out).toContain("512 MiB");
  });
});

describe("summaries", () => {
  it("summarizes a timeseries by total", () => {
    const def = METRICS.find((m) => m.name === "bandwidth")!;
    const resp: AnalyticsResponse<AnalyticsSeries> = {
      key: "bandwidth",
      data: [{ name: "bandwidth", total: 1073741824, dataset: [] }],
    };
    expect(summarizeMetric(def, resp)).toBe("Server bandwidth=1.00 GiB");
  });

  it("summarizes response codes as errors over total", () => {
    const def = METRICS.find((m) => m.name === "response-codes")!;
    const resp: AnalyticsResponse<AnalyticsResponseCodeEntry> = {
      key: "responseCode",
      data: [
        { response_code: "200", data: [{ key: "d", value: "900" }] },
        { response_code: "500", data: [{ key: "d", value: "100" }] },
      ],
    };
    expect(summarizeMetric(def, resp)).toBe("Response codes=100 err / 1,000");
  });

  it("summarizes usage compactly", () => {
    expect(summarizeUsage({ visits: 100, bandwidth: 1024, cdnBandwidth: 0 })).toContain(
      "visits=100",
    );
  });
});

describe("KinstaClient analytics (replayed fixtures)", () => {
  it("fetches a visits timeseries with company_id + time_span", async () => {
    const resp = await makeClient().getAnalytics<AnalyticsSeries>("env-1", "visits", {
      time_span: "7_days",
    });
    expect(resp.key).toBe("uniqueip");
    expect(seriesTotal(resp)).toBe(1234);
  });

  it("aggregates this-month usage across the three dimensions", async () => {
    const usage = await makeClient().getUsage("11111111-1111-4111-8111-111111111111");
    expect(usage.visits).toBe(15230);
    expect(usage.bandwidth).toBe(32212254720);
    expect(usage.cdnBandwidth).toBe(16106127360);
  });
});

describe("analyticsCommand", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("prints JSON with the requested metrics for a single site", async () => {
    await analyticsCommand(makeClient(), "bravosite", {
      metric: ["visits", "usage"],
      json: true,
    });
    const parsed = JSON.parse(loggedOutput());
    expect(parsed.site).toBe("bravosite");
    expect(parsed.metrics.visits.key).toBe("uniqueip");
    expect(parsed.metrics.usage.visits).toBe(15230);
  });

  it("requires a site or --all", async () => {
    await expect(analyticsCommand(makeClient(), undefined, {})).rejects.toThrow(/--all/);
  });

  it("prints a compact per-site line for --all", async () => {
    await analyticsCommand(makeClient(), undefined, { all: true, metric: ["visits"] });
    const out = loggedOutput();
    expect(out).toContain("alphasite");
    expect(out).toContain("bravosite");
    expect(out).toContain("Visits=");
  });

  it("rejects an invalid span", async () => {
    await expect(analyticsCommand(makeClient(), "bravosite", { span: "90_days" })).rejects.toThrow(
      /Invalid --span/,
    );
  });
});
