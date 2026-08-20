import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { KinstaApiError, KinstaClient } from "../src/api.ts";
import { BASE } from "./mocks/handlers.ts";
import { server } from "./mocks/server.ts";

function makeClient(overrides: Partial<ConstructorParameters<typeof KinstaClient>[0]> = {}) {
  return new KinstaClient({
    apiKey: "test-key",
    companyId: "company-123",
    baseDelayMs: 1,
    sleep: () => Promise.resolve(),
    ...overrides,
  });
}

describe("KinstaClient (replayed against recorded fixtures)", () => {
  it("lists sites for the configured company", async () => {
    const client = makeClient();
    const sites = await client.listSites();
    expect(sites).toHaveLength(3);
    expect(sites.map((s) => s.name)).toContain("bravosite");
  });

  it("sends the company id and bearer token", async () => {
    let captured: URL | undefined;
    let auth: string | null = null;
    server.use(
      http.get(`${BASE}/sites`, ({ request }) => {
        captured = new URL(request.url);
        auth = request.headers.get("authorization");
        return HttpResponse.json({ company: { sites: [] } });
      }),
    );
    await makeClient().listSites();
    expect(captured?.searchParams.get("company")).toBe("company-123");
    expect(captured?.searchParams.get("include_environments")).toBe("true");
    expect(auth).toBe("Bearer test-key");
  });

  it("fetches ssh config and password", async () => {
    const client = makeClient();
    const config = await client.getSshConfig("site", "env");
    expect(config.port).toBe("12002");
    expect(config.user).toBe("bravosite");
    const password = await client.getSshPassword("env");
    expect(password).toBe("fake-Passw0rd-not-real-2f8b1c");
  });

  it("returns operation ids for cache and php operations", async () => {
    const client = makeClient();
    expect(await client.clearCache("env")).toMatch(/^cache:clear-/);
    expect(await client.restartPhp("env")).toMatch(/restart-php/);
    expect(await client.clearCdnCache("env", "cdn")).toMatch(/^cdn-cache:clear-/);
    expect(await client.clearEdgeCache("env")).toMatch(/^edgeCache:clear-/);
  });

  it("parses error logs into non-empty lines", async () => {
    const client = makeClient();
    const lines = await client.getLogs("a2222222-2222-4222-8222-222222222222");
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes("substr()"))).toBe(true);
  });

  it("throws KinstaApiError with status on 4xx", async () => {
    server.use(
      http.get(`${BASE}/sites`, () =>
        HttpResponse.json({ status: 404, message: "Site not found" }, { status: 404 }),
      ),
    );
    await expect(makeClient().listSites()).rejects.toMatchObject({
      name: "KinstaApiError",
      status: 404,
    });
  });

  it("surfaces a 401 when authentication is missing", async () => {
    // A client that sends no bearer prefix triggers the auth guard.
    const client = new KinstaClient({
      apiKey: "",
      companyId: "c",
      baseDelayMs: 1,
      sleep: () => Promise.resolve(),
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.delete("authorization");
        return fetch(input, { ...init, headers });
      },
    });
    await expect(client.listSites()).rejects.toBeInstanceOf(KinstaApiError);
  });

  it("retries on rate limiting and eventually succeeds", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/sites`, () => {
        calls += 1;
        if (calls < 3) {
          return HttpResponse.json({ message: "Too many requests" }, { status: 429 });
        }
        return HttpResponse.json({ company: { sites: [] } });
      }),
    );
    const client = makeClient({ maxRetries: 5 });
    const sites = await client.listSites();
    expect(sites).toEqual([]);
    expect(calls).toBe(3);
  });

  it("gives up after exhausting retries on persistent rate limiting", async () => {
    server.use(
      http.get(`${BASE}/sites`, () =>
        HttpResponse.json({ message: "Too many requests" }, { status: 429 }),
      ),
    );
    const client = makeClient({ maxRetries: 2 });
    await expect(client.listSites()).rejects.toMatchObject({ status: 429 });
  });

  it("serializes concurrent requests", async () => {
    // Ensure the queue does not drop or interleave requests.
    const client = makeClient();
    const results = await Promise.all([client.listSites(), client.listSites(), client.listSites()]);
    expect(results.every((r) => r.length === 3)).toBe(true);
  });

  it("runs a WP-CLI command and returns the operation id", async () => {
    let body: unknown;
    server.use(
      http.post(`${BASE}/sites/environments/:envId/run-wp-cli-command`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ operation_id: "op-123", status: 202 }, { status: 202 });
      }),
    );
    const id = await makeClient().runWpCli("env-1", "wp core version");
    expect(id).toBe("op-123");
    expect(body).toEqual({ wp_command: "wp core version" });
  });

  it("polls an operation until it leaves the in-progress state", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/operations/:operationId`, () => {
        calls += 1;
        if (calls < 3) {
          return HttpResponse.json({ status: 202, message: "in progress" }, { status: 202 });
        }
        return HttpResponse.json({ status: 200, message: "done" }, { status: 200 });
      }),
    );
    const result = await makeClient().waitForOperation("op-1", { intervalMs: 0, maxAttempts: 10 });
    expect(result.status).toBe(200);
    expect(result.timedOut).toBe(false);
    expect(calls).toBe(3);
  });

  it("treats a 404 operation as still pending while polling", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/operations/:operationId`, () => {
        calls += 1;
        if (calls < 2) return HttpResponse.json({ message: "not found" }, { status: 404 });
        return HttpResponse.json({ status: 200, message: "done" }, { status: 200 });
      }),
    );
    const result = await makeClient().waitForOperation("op-1", { intervalMs: 0, maxAttempts: 5 });
    expect(result.status).toBe(200);
    expect(result.timedOut).toBe(false);
  });

  it("reports a timeout when the operation never finishes", async () => {
    server.use(
      http.get(`${BASE}/operations/:operationId`, () =>
        HttpResponse.json({ status: 202, message: "in progress" }, { status: 202 }),
      ),
    );
    const result = await makeClient().waitForOperation("op-1", { intervalMs: 0, maxAttempts: 3 });
    expect(result.timedOut).toBe(true);
    expect(result.status).toBe(202);
  });
});
