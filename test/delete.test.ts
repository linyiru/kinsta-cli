import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KinstaClient } from "../src/api.ts";
import { DeleteAbortedError, deleteSiteCommand } from "../src/commands/delete.ts";
import { SiteResolutionError } from "../src/resolve.ts";
import error404 from "./fixtures/error-404.json";
import { BASE } from "./mocks/handlers.ts";
import { server } from "./mocks/server.ts";

function makeClient() {
  return new KinstaClient({
    apiKey: "test-key",
    companyId: "company-123",
    baseDelayMs: 1,
    sleep: () => Promise.resolve(),
  });
}

/** GET /sites/:id answers with `site`, then 404s once the delete has run. */
function stubSite(name: string, opts: { goneAfterDelete?: boolean } = {}) {
  let deleted = false;
  server.use(
    http.get(`${BASE}/sites/:siteId`, ({ params }) => {
      if (deleted && opts.goneAfterDelete) {
        return HttpResponse.json(error404, { status: 404 });
      }
      return HttpResponse.json({
        site: {
          id: params.siteId,
          name,
          display_name: `${name}.com`,
          status: "live",
          environments: [{ id: "env-1", name: "live", domains: [{ name: `${name}.com` }] }],
        },
      });
    }),
    http.delete(`${BASE}/sites/:siteId`, () => {
      deleted = true;
      return HttpResponse.json({ operation_id: "sites:delete-1" }, { status: 202 });
    }),
  );
}

describe("deleteSiteCommand", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  });

  it("refuses a substring match", async () => {
    stubSite("bravosite");
    await expect(deleteSiteCommand(makeClient(), "bravo")).rejects.toBeInstanceOf(
      SiteResolutionError,
    );
  });

  it("refuses on non-interactive stdin without --confirm", async () => {
    stubSite("bravosite");
    await expect(deleteSiteCommand(makeClient(), "bravosite")).rejects.toBeInstanceOf(
      DeleteAbortedError,
    );
  });

  it("rejects a --confirm value that is not the resolved site name", async () => {
    // Resolving by domain is allowed, but the confirmation must be the site
    // name the summary printed — not the domain the operator typed.
    stubSite("bravosite");
    await expect(
      deleteSiteCommand(makeClient(), "example-bravo.com", { confirm: "example-bravo.com" }),
    ).rejects.toBeInstanceOf(DeleteAbortedError);
  });

  it("does not call DELETE for --dry-run", async () => {
    let deleteCalls = 0;
    stubSite("bravosite");
    server.use(
      http.delete(`${BASE}/sites/:siteId`, () => {
        deleteCalls += 1;
        return HttpResponse.json({ operation_id: "sites:delete-1" }, { status: 202 });
      }),
    );
    await deleteSiteCommand(makeClient(), "bravosite", { dryRun: true });
    expect(deleteCalls).toBe(0);
  });

  it("aborts if the site is renamed while awaiting confirmation", async () => {
    // Two GETs happen: one for the summary, one immediately before the delete.
    // A rename landing between them must stop the irreversible call.
    let reads = 0;
    let deleteCalls = 0;
    server.use(
      http.get(`${BASE}/sites/:siteId`, ({ params }) => {
        reads += 1;
        return HttpResponse.json({
          site: {
            id: params.siteId,
            name: reads === 1 ? "bravosite" : "renamed-mid-flight",
            display_name: "Bravo Site",
            status: "live",
            environments: [{ id: "env-1", name: "live", domains: [{ name: "example-bravo.com" }] }],
          },
        });
      }),
      http.delete(`${BASE}/sites/:siteId`, () => {
        deleteCalls += 1;
        return HttpResponse.json({ operation_id: "sites:delete-1" }, { status: 202 });
      }),
    );
    await expect(
      deleteSiteCommand(makeClient(), "bravosite", { confirm: "bravosite" }),
    ).rejects.toBeInstanceOf(DeleteAbortedError);
    expect(deleteCalls).toBe(0);
  });

  it("deletes and confirms the site is gone", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    stubSite("bravosite", { goneAfterDelete: true });
    await deleteSiteCommand(makeClient(), "bravosite", { confirm: "bravosite" });
    const output = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("deleted");
  });
});
