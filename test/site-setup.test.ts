import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KinstaClient } from "../src/api.ts";
import { backupCreateCommand } from "../src/commands/backup.ts";
import { CloneError, cloneSiteCommand } from "../src/commands/clone.ts";
import {
  domainAddCommand,
  DomainNotFoundError,
  domainPrimaryCommand,
} from "../src/commands/domain.ts";
import { OperationFailedError } from "../src/operation.ts";
import { SiteResolutionError } from "../src/resolve.ts";
import sites from "./fixtures/sites.json";
import { BASE } from "./mocks/handlers.ts";
import { server } from "./mocks/server.ts";

const BRAVO_ENV = "a2222222-2222-4222-8222-222222222222";

function makeClient() {
  return new KinstaClient({
    apiKey: "test-key",
    companyId: "company-123",
    baseDelayMs: 1,
    sleep: () => Promise.resolve(),
  });
}

function stubOperation(status = 200, message = "Successfully finished request.") {
  server.use(http.get(`${BASE}/operations/:id`, () => HttpResponse.json({ status, message })));
}

function output(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
}

describe("backupCreateCommand", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("posts the tag to the live environment", async () => {
    let body: unknown;
    let path = "";
    server.use(
      http.post(`${BASE}/sites/environments/:envId/manual-backups`, async ({ request }) => {
        path = new URL(request.url).pathname;
        body = await request.json();
        return HttpResponse.json({ operation_id: "backups:add-manual-1" }, { status: 202 });
      }),
    );
    stubOperation();
    await backupCreateCommand(makeClient(), "bravosite", { tag: "pre-upgrade" });
    expect(path).toBe(`/v2/sites/environments/${BRAVO_ENV}/manual-backups`);
    expect(body).toEqual({ tag: "pre-upgrade" });
  });
});

describe("cloneSiteCommand", () => {
  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("refuses a substring match", async () => {
    await expect(
      cloneSiteCommand(makeClient(), "bravo", { name: "New Site" }),
    ).rejects.toBeInstanceOf(SiteResolutionError);
  });

  it("refuses a display name that is already taken", async () => {
    await expect(
      cloneSiteCommand(makeClient(), "bravosite", { name: "alpha site" }),
    ).rejects.toBeInstanceOf(CloneError);
  });

  it("clones, waits, and reports the new site", async () => {
    let body: unknown;
    let cloned = false;
    const newSite = {
      id: "44444444-4444-4444-8444-444444444444",
      name: "newsite",
      display_name: "New Site",
      status: "live",
      environments: [
        {
          id: "a4444444-4444-4444-8444-444444444444",
          name: "live",
          display_name: "Live",
          domains: [{ id: "d4", name: "newsite.kinsta.cloud", type: "live" }],
        },
      ],
    };
    server.use(
      http.post(`${BASE}/sites/clone`, async ({ request }) => {
        body = await request.json();
        cloned = true;
        return HttpResponse.json({ operation_id: "sites:clone-1" }, { status: 202 });
      }),
      http.get(`${BASE}/sites`, () =>
        HttpResponse.json({
          company: { sites: cloned ? [...sites.company.sites, newSite] : sites.company.sites },
        }),
      ),
    );
    stubOperation();

    await cloneSiteCommand(makeClient(), "bravosite", { name: "New Site" });

    expect(body).toEqual({
      company: "company-123",
      display_name: "New Site",
      source_env_id: BRAVO_ENV,
    });
    const text = output(log);
    expect(text).toContain("newsite");
    expect(text).toContain("a4444444-4444-4444-8444-444444444444");
    expect(text).toContain("newsite.kinsta.cloud");
  });

  it("fails when the clone operation fails", async () => {
    server.use(
      http.post(`${BASE}/sites/clone`, () =>
        HttpResponse.json({ operation_id: "sites:clone-1" }, { status: 202 }),
      ),
    );
    stubOperation(500, "Cloning failed");
    await expect(
      cloneSiteCommand(makeClient(), "bravosite", { name: "New Site" }),
    ).rejects.toBeInstanceOf(OperationFailedError);
  });
});

describe("domain commands", () => {
  let log: ReturnType<typeof vi.spyOn>;
  let domains: { id: string; name: string; uses_cloudflare_dns: boolean }[];
  let posted: unknown[];

  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    domains = [{ id: "d-temp", name: "bravosite.kinsta.cloud", uses_cloudflare_dns: true }];
    posted = [];
    server.use(
      http.get(`${BASE}/sites/environments/:envId/domains`, () =>
        HttpResponse.json({ environment: { site_domains: domains } }),
      ),
      http.post(`${BASE}/sites/environments/:envId/domains`, async ({ request }) => {
        const body = (await request.json()) as { domain_name: string };
        posted.push(body);
        domains.push({
          id: `d-${body.domain_name}`,
          name: body.domain_name,
          uses_cloudflare_dns: false,
        });
        return HttpResponse.json({ operation_id: "sites:add-domain-1" }, { status: 202 });
      }),
      http.get(`${BASE}/sites/environments/domains/:id/verification-records`, ({ params }) =>
        HttpResponse.json({
          site_domain: {
            verification_records: [
              {
                type: "CNAME",
                name: `_acme-challenge.${params.id}`,
                value: "x.kinstavalidation.app",
              },
            ],
            pointing_records: [{ type: "A", name: String(params.id), value: "192.0.2.10" }],
          },
        }),
      ),
    );
    stubOperation();
  });

  it("adds each new domain wildcardless and prints its records", async () => {
    await domainAddCommand(makeClient(), "bravosite", [
      "Example.com.",
      "www.example.com",
      "bravosite.kinsta.cloud",
    ]);
    expect(posted).toEqual([
      { domain_name: "example.com", is_wildcardless: true },
      { domain_name: "www.example.com", is_wildcardless: true },
    ]);
    const text = output(log);
    expect(text).toContain("bravosite.kinsta.cloud is already on this site");
    expect(text).toContain("_acme-challenge.d-example.com");
    expect(text).toContain("192.0.2.10");
  });

  it("changes the primary domain with search-replace by default", async () => {
    domains.push({ id: "d-main", name: "example.com", uses_cloudflare_dns: false });
    let body: unknown;
    server.use(
      http.put(`${BASE}/sites/environments/:envId/change-primary-domain`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ operation_id: "sites:change-primary-1" }, { status: 202 });
      }),
    );
    await domainPrimaryCommand(makeClient(), "bravosite", "example.com");
    expect(body).toEqual({ domain_id: "d-main", run_search_and_replace: true });
  });

  it("reports the nested reason when adding a domain fails", async () => {
    server.use(
      http.get(`${BASE}/operations/:id`, () =>
        HttpResponse.json({
          status: 500,
          message: "Operation failed! Please refer to `data` for more details.",
          data: { status: 500, message: 'This domain "example.com" is already in use', data: null },
        }),
      ),
    );
    await expect(domainAddCommand(makeClient(), "bravosite", ["example.com"])).rejects.toThrow(
      'This domain "example.com" is already in use',
    );
  });

  it("refuses a domain the site does not have", async () => {
    await expect(
      domainPrimaryCommand(makeClient(), "bravosite", "example.com"),
    ).rejects.toBeInstanceOf(DomainNotFoundError);
  });
});
