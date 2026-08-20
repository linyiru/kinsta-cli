import type { Environment, Site, SshConfig } from "./types.ts";

export const DEFAULT_BASE_URL = "https://api.kinsta.com/v2";

export interface KinstaClientOptions {
  apiKey: string;
  companyId: string;
  baseUrl?: string;
  /** Injectable for testing; defaults to the global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Max retries on rate-limit (429) responses. */
  maxRetries?: number;
  /** Base backoff in ms for rate-limit retries (exponential). */
  baseDelayMs?: number;
  /** Sleep implementation (injectable for testing). */
  sleep?: (ms: number) => Promise<void>;
}

export class KinstaApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = "KinstaApiError";
  }
}

interface RequestOptions {
  method?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

const RATE_LIMIT_HINT = "too many requests";

function isRateLimited(status: number, body: unknown): boolean {
  if (status === 429) return true;
  const message =
    body && typeof body === "object" && "message" in body
      ? String((body as { message: unknown }).message)
      : "";
  return message.toLowerCase().includes(RATE_LIMIT_HINT);
}

function extractMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "message" in body) {
    const m = (body as { message: unknown }).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  return fallback;
}

/**
 * Thin, dependency-free client over the Kinsta REST API.
 *
 * Requests are serialized through an internal promise chain and retried with
 * exponential backoff whenever the API signals rate limiting, since Kinsta
 * aggressively throttles bursty parallel calls.
 */
export class KinstaClient {
  private readonly apiKey: string;
  private readonly companyId: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: KinstaClientOptions) {
    this.apiKey = options.apiKey;
    this.companyId = options.companyId;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.maxRetries = options.maxRetries ?? 5;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.sleep =
      options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    // Serialize all API calls to avoid tripping Kinsta's burst rate limiter.
    const run = this.queue.then(() => this.execute<T>(path, options));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async execute<T>(path: string, options: RequestOptions): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    let lastError: KinstaApiError | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const response = await this.fetchImpl(url, {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });

      const text = await response.text();
      let body: unknown = undefined;
      if (text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }

      if (isRateLimited(response.status, body)) {
        lastError = new KinstaApiError(response.status, body, "Kinsta API rate limit hit");
        if (attempt < this.maxRetries) {
          await this.sleep(this.baseDelayMs * 2 ** attempt);
          continue;
        }
        throw lastError;
      }

      if (!response.ok) {
        throw new KinstaApiError(
          response.status,
          body,
          extractMessage(body, `Kinsta API request failed (${response.status})`),
        );
      }

      return body as T;
    }

    throw lastError ?? new KinstaApiError(0, undefined, "Kinsta API request failed");
  }

  /** GET /sites — all sites for the configured company, with environments. */
  async listSites(): Promise<Site[]> {
    const data = await this.request<{ company: { sites: Site[] } }>("/sites", {
      query: { company: this.companyId, include_environments: true },
    });
    return data.company?.sites ?? [];
  }

  /** GET /sites/{site_id}/environments — environments for a single site. */
  async listEnvironments(siteId: string): Promise<Environment[]> {
    const data = await this.request<{ site: { environments: Environment[] } }>(
      `/sites/${siteId}/environments`,
    );
    return data.site?.environments ?? [];
  }

  /** GET /sites/{site_id}/environments/{env_id}/ssh/config */
  async getSshConfig(siteId: string, envId: string): Promise<SshConfig> {
    const data = await this.request<{ environment: SshConfig }>(
      `/sites/${siteId}/environments/${envId}/ssh/config`,
    );
    return data.environment;
  }

  /** GET /sites/environments/{env_id}/ssh/password — the real SFTP/SSH password. */
  async getSshPassword(envId: string): Promise<string> {
    const data = await this.request<{ environment: { sftp_password: string } }>(
      `/sites/environments/${envId}/ssh/password`,
    );
    return data.environment.sftp_password;
  }

  /** POST /sites/tools/clear-cache — clears the site (page) cache. */
  async clearCache(envId: string): Promise<string> {
    const data = await this.request<{ operation_id: string }>("/sites/tools/clear-cache", {
      method: "POST",
      body: { environment_id: envId },
    });
    return data.operation_id;
  }

  /** POST /sites/cdn/clear-cache — clears the CDN cache (needs cdn_cache_id). */
  async clearCdnCache(envId: string, cdnCacheId: string): Promise<string> {
    const data = await this.request<{ operation_id: string }>("/sites/cdn/clear-cache", {
      method: "POST",
      body: { environment_id: envId, cdn_cache_id: cdnCacheId },
    });
    return data.operation_id;
  }

  /** POST /sites/edge-caching/clear — clears Kinsta edge cache. */
  async clearEdgeCache(envId: string, clearSubdirectories = true): Promise<string> {
    const data = await this.request<{ operation_id: string }>("/sites/edge-caching/clear", {
      method: "POST",
      body: { environment_id: envId, clear_subdirectories: clearSubdirectories },
    });
    return data.operation_id;
  }

  /** POST /sites/tools/restart-php — restarts PHP (clears OPcache). */
  async restartPhp(envId: string): Promise<string> {
    const data = await this.request<{ operation_id: string }>("/sites/tools/restart-php", {
      method: "POST",
      body: { environment_id: envId },
    });
    return data.operation_id;
  }

  /**
   * GET /sites/environments/{env_id}/logs — returns log lines (newest last).
   * `fileName` is one of error | access | kinsta-cache-perf.
   */
  async getLogs(
    envId: string,
    opts: {
      fileName?: "error" | "access" | "kinsta-cache-perf";
      lines?: number;
      search?: string;
    } = {},
  ): Promise<string[]> {
    const data = await this.request<{
      environment: { container_info: { logs: string } };
    }>(`/sites/environments/${envId}/logs`, {
      query: {
        file_name: opts.fileName ?? "error",
        lines: opts.lines ?? 1000,
        search: opts.search,
      },
    });
    const raw = data.environment?.container_info?.logs ?? "";
    return raw.split("\n").filter((line) => line.trim().length > 0);
  }
}
