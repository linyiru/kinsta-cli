import { describe, expect, it } from "vitest";
import {
  isValidWpCommand,
  WP_COMMAND_MAX_LENGTH,
  WP_ROCKET_REMEDIATION_COMMANDS,
  WpCommandError,
} from "../src/wpcli.ts";

describe("isValidWpCommand", () => {
  it("accepts a plain wp command", () => {
    expect(isValidWpCommand("wp core version")).toBe(true);
    expect(isValidWpCommand("wp plugin deactivate wp-rocket --skip-plugins")).toBe(true);
    expect(isValidWpCommand("wp config set WP_CACHE false --raw")).toBe(true);
    expect(isValidWpCommand("wp user list --role=administrator")).toBe(true);
  });

  it("trims surrounding whitespace before validating", () => {
    expect(isValidWpCommand("  wp core version  ")).toBe(true);
  });

  it("rejects commands that do not start with wp", () => {
    expect(isValidWpCommand("ls -la")).toBe(false);
    expect(isValidWpCommand("core version")).toBe(false);
    expect(isValidWpCommand("wpcli core version")).toBe(false);
  });

  it("rejects shell chaining and dangerous metacharacters", () => {
    expect(isValidWpCommand("wp plugin deactivate wp-rocket && rm advanced-cache.php")).toBe(false);
    expect(isValidWpCommand("wp core version; ls")).toBe(false);
    expect(isValidWpCommand("wp core version | cat")).toBe(false);
    expect(isValidWpCommand('wp option get "siteurl"')).toBe(false);
    expect(isValidWpCommand("wp eval $(cat secret)")).toBe(false);
  });

  it("rejects commands over the length cap", () => {
    expect(isValidWpCommand(`wp ${"a".repeat(WP_COMMAND_MAX_LENGTH)}`)).toBe(false);
  });
});

describe("WpCommandError", () => {
  it("carries the offending command", () => {
    const err = new WpCommandError("rm -rf /");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("WpCommandError");
    expect(err.command).toBe("rm -rf /");
    expect(err.message).toContain("rm -rf /");
  });
});

describe("WP_ROCKET_REMEDIATION_COMMANDS", () => {
  it("are all valid single wp commands the API accepts", () => {
    expect(WP_ROCKET_REMEDIATION_COMMANDS.length).toBeGreaterThan(0);
    for (const cmd of WP_ROCKET_REMEDIATION_COMMANDS) {
      expect(isValidWpCommand(cmd)).toBe(true);
    }
  });
});
