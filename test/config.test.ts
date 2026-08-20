import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.ts";

describe("loadConfig", () => {
  it("reads api key and company id from the environment", () => {
    const config = loadConfig({
      KINSTA_API_KEY: "  key  ",
      KINSTA_COMPANY_ID: "company",
    } as NodeJS.ProcessEnv);
    expect(config).toEqual({ apiKey: "key", companyId: "company" });
  });

  it("throws ConfigError listing every missing variable", () => {
    try {
      loadConfig({} as NodeJS.ProcessEnv);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).missing).toEqual(["KINSTA_API_KEY", "KINSTA_COMPANY_ID"]);
    }
  });

  it("reports only the missing variable", () => {
    expect(() => loadConfig({ KINSTA_API_KEY: "k" } as NodeJS.ProcessEnv)).toThrow(
      /KINSTA_COMPANY_ID/,
    );
  });
});
