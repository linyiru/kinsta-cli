import { describe, expect, it } from "vitest";
import { pickLiveEnv, primaryDomainOf, resolveSite, SiteResolutionError } from "../src/resolve.ts";
import type { Site } from "../src/types.ts";
import sitesFixture from "./fixtures/sites.json";

const sites = sitesFixture.company.sites as unknown as Site[];

describe("pickLiveEnv", () => {
  it("prefers the live environment over staging", () => {
    const charlie = sites.find((s) => s.name === "charliesite") as Site;
    expect(pickLiveEnv(charlie)?.name).toBe("live");
  });
});

describe("primaryDomainOf", () => {
  it("returns the primary domain name", () => {
    const alpha = sites.find((s) => s.name === "alphasite") as Site;
    expect(primaryDomainOf(pickLiveEnv(alpha))).toBe("example-alpha.com");
  });

  it("returns undefined for no env", () => {
    expect(primaryDomainOf(undefined)).toBeUndefined();
  });
});

describe("resolveSite", () => {
  it("resolves by exact site name to the live env", () => {
    const { site, env } = resolveSite(sites, "charliesite");
    expect(site.name).toBe("charliesite");
    expect(env.name).toBe("live");
  });

  it("resolves by domain", () => {
    const { site } = resolveSite(sites, "example-bravo.com");
    expect(site.name).toBe("bravosite");
  });

  it("resolves by substring", () => {
    const { site } = resolveSite(sites, "alpha");
    expect(site.name).toBe("alphasite");
  });

  it("throws when nothing matches", () => {
    expect(() => resolveSite(sites, "nope")).toThrow(SiteResolutionError);
  });

  it("throws with candidates when ambiguous", () => {
    try {
      resolveSite(sites, "site");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SiteResolutionError);
      expect((err as SiteResolutionError).matches.length).toBeGreaterThan(1);
    }
  });
});
