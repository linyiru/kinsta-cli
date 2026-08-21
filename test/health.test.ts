import { describe, expect, it } from "vitest";
import { checkHealth, type HealthTarget } from "../src/commands/health.ts";

const targets: HealthTarget[] = [
  { name: "alpha", domain: "example-alpha.com", siteId: "1", envId: "e1" },
  { name: "bravo", domain: "example-bravo.com", siteId: "2", envId: "e2" },
  { name: "down", domain: "down.example.com", siteId: "3", envId: "e3" },
];

describe("checkHealth", () => {
  it("classifies ok, server_error and unreachable", async () => {
    const fetchImpl = ((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("example-alpha"))
        return Promise.resolve(new Response("<html>ok</html>", { status: 200 }));
      if (url.includes("example-bravo"))
        return Promise.resolve(new Response(null, { status: 500 }));
      return Promise.reject(new Error("ENOTFOUND"));
    }) as typeof globalThis.fetch;

    const results = await checkHealth(targets, {
      fetch: fetchImpl,
      concurrency: 3,
      nonce: () => "NONCE",
    });

    const byName = Object.fromEntries(results.map((r) => [r.name, r]));
    expect(byName.alpha?.category).toBe("ok");
    expect(byName.bravo?.category).toBe("server_error");
    expect(byName.down?.category).toBe("unreachable");
    expect(byName.down?.status).toBe(0);
  });

  it("reports a 200 with an empty body as blank", async () => {
    const fetchImpl = ((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("example-alpha"))
        return Promise.resolve(new Response("   \n  ", { status: 200 }));
      return Promise.resolve(new Response("<html>ok</html>", { status: 200 }));
    }) as typeof globalThis.fetch;

    const results = await checkHealth(targets, { fetch: fetchImpl, nonce: () => "NONCE" });
    const byName = Object.fromEntries(results.map((r) => [r.name, r]));
    expect(byName.alpha?.category).toBe("blank");
    expect(byName.alpha?.status).toBe(200);
    expect(byName.bravo?.category).toBe("ok");
    expect(byName.bravo?.bytes).toBeGreaterThan(0);
  });

  it("appends a cache-busting query param to every request", async () => {
    const seen: string[] = [];
    const fetchImpl = ((input: string | URL | Request) => {
      seen.push(String(input));
      return Promise.resolve(new Response("<html>ok</html>", { status: 200 }));
    }) as typeof globalThis.fetch;

    await checkHealth(targets, { fetch: fetchImpl, nonce: () => "NONCE" });
    expect(seen).toHaveLength(3);
    expect(seen.every((u) => u.includes("kinstahealth=NONCE"))).toBe(true);
  });

  it("hits the bare URL (no cache-buster) when cacheBust is false", async () => {
    const seen: string[] = [];
    const fetchImpl = ((input: string | URL | Request) => {
      seen.push(String(input));
      return Promise.resolve(new Response("<html>ok</html>", { status: 200 }));
    }) as typeof globalThis.fetch;

    await checkHealth(targets, { fetch: fetchImpl, cacheBust: false });
    expect(seen.every((u) => !u.includes("kinstahealth"))).toBe(true);
    expect(seen).toContain("https://example-alpha.com/");
  });
});
