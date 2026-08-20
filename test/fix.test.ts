import { beforeEach, describe, expect, it, vi } from "vitest";
import { KinstaClient } from "../src/api.ts";
import { fixWpRocketCommand } from "../src/commands/fix.ts";
import { FakeSshRunner } from "./mocks/ssh.ts";

function makeClient() {
  return new KinstaClient({
    apiKey: "test-key",
    companyId: "company-123",
    baseDelayMs: 1,
    sleep: () => Promise.resolve(),
  });
}

const okFetch = (() =>
  Promise.resolve(new Response(null, { status: 200 }))) as typeof globalThis.fetch;

describe("fixWpRocketCommand", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  it("remediates a confirmed wp-rocket site and verifies it recovers", async () => {
    const runner = new FakeSshRunner();
    const results = await fixWpRocketCommand(makeClient(), "bravosite", {
      runner,
      fetch: okFetch,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.verifiedStatus).toBe(200);
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.command).toContain("wp plugin deactivate wp-rocket");
    expect(runner.calls[0]?.command).toContain("advanced-cache.php");
  });

  it("skips a site with no wp-rocket fatal unless forced", async () => {
    const runner = new FakeSshRunner();
    const results = await fixWpRocketCommand(makeClient(), "alphasite", {
      runner,
      fetch: okFetch,
    });
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.action).toBe("skipped");
    expect(runner.calls).toHaveLength(0);
  });

  it("makes no changes in dry-run mode", async () => {
    const runner = new FakeSshRunner();
    const results = await fixWpRocketCommand(makeClient(), "bravosite", {
      runner,
      fetch: okFetch,
      dryRun: true,
    });
    expect(results[0]?.action).toContain("dry-run");
    expect(runner.calls).toHaveLength(0);
  });

  it("reports failure when the ssh marker is missing", async () => {
    const runner = new FakeSshRunner({ code: 1, stdout: "boom", stderr: "wp: command not found" });
    const results = await fixWpRocketCommand(makeClient(), "bravosite", {
      runner,
      fetch: okFetch,
    });
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.action).toContain("failed");
  });

  it("requires a site or --all", async () => {
    await expect(
      fixWpRocketCommand(makeClient(), undefined, { runner: new FakeSshRunner() }),
    ).rejects.toThrow(/--all/);
  });
});
