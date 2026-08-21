import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KinstaClient } from "../src/api.ts";
import { fixWpRocketCommand } from "../src/commands/fix.ts";
import runWpCli from "./fixtures/run-wp-cli.json";
import { BASE } from "./mocks/handlers.ts";
import { server } from "./mocks/server.ts";
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
  Promise.resolve(new Response("<html>ok</html>", { status: 200 }))) as typeof globalThis.fetch;
const brokenFetch = (() =>
  Promise.resolve(new Response(null, { status: 500 }))) as typeof globalThis.fetch;
const blankFetch = (() =>
  Promise.resolve(new Response("", { status: 200 }))) as typeof globalThis.fetch;
const noSleep = () => Promise.resolve();

describe("fixWpRocketCommand (API default)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  it("remediates a confirmed wp-rocket site via the API and verifies recovery", async () => {
    const wpCommands: string[] = [];
    server.use(
      http.post(`${BASE}/sites/environments/:envId/run-wp-cli-command`, async ({ request }) => {
        const body = (await request.json()) as { wp_command: string };
        wpCommands.push(body.wp_command);
        return HttpResponse.json(runWpCli, { status: 202 });
      }),
    );

    const results = await fixWpRocketCommand(makeClient(), "bravosite", { fetch: okFetch });

    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.verifiedStatus).toBe(200);
    expect(wpCommands).toEqual([
      "wp plugin deactivate wp-rocket --skip-plugins --skip-themes",
      "wp config set WP_CACHE false --raw",
    ]);
  });

  it("waits for each operation when --wait is set", async () => {
    const results = await fixWpRocketCommand(makeClient(), "bravosite", {
      fetch: okFetch,
      wait: true,
    });
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.verifiedStatus).toBe(200);
  });

  it("reports failure when the homepage still 500s after the fix", async () => {
    const results = await fixWpRocketCommand(makeClient(), "bravosite", {
      fetch: brokenFetch,
      verifyAttempts: 2,
      sleep: noSleep,
    });
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.verifiedStatus).toBe(500);
    expect(results[0]?.note).toContain("still returning an error");
  });

  it("reports failure when the homepage returns a blank 200 after the fix", async () => {
    let clears = 0;
    server.use(
      http.post(`${BASE}/sites/tools/clear-cache`, () => {
        clears += 1;
        return HttpResponse.json({ operation_id: "cache:clear-blank" });
      }),
    );
    const results = await fixWpRocketCommand(makeClient(), "bravosite", {
      fetch: blankFetch,
      verifyAttempts: 3,
      sleep: noSleep,
    });
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.category).toBe("blank");
    expect(results[0]?.note).toContain("blank");
    // one clear during remediation + one re-clear per failed blank retry
    expect(clears).toBeGreaterThan(1);
  });

  it("recovers when a stale blank cache clears on a later verification attempt", async () => {
    let calls = 0;
    const flakyFetch = (() => {
      calls += 1;
      return Promise.resolve(
        calls === 1
          ? new Response("", { status: 200 })
          : new Response("<html>ok</html>", { status: 200 }),
      );
    }) as typeof globalThis.fetch;

    const results = await fixWpRocketCommand(makeClient(), "bravosite", {
      fetch: flakyFetch,
      verifyAttempts: 3,
      sleep: noSleep,
    });
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.category).toBe("ok");
  });

  it("skips a site with no wp-rocket fatal unless forced", async () => {
    const results = await fixWpRocketCommand(makeClient(), "alphasite", { fetch: okFetch });
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.action).toBe("skipped");
  });

  it("makes no changes in dry-run mode", async () => {
    const results = await fixWpRocketCommand(makeClient(), "bravosite", {
      fetch: okFetch,
      dryRun: true,
    });
    expect(results[0]?.action).toContain("dry-run");
  });

  it("requires a site or --all", async () => {
    await expect(fixWpRocketCommand(makeClient(), undefined, {})).rejects.toThrow(/--all/);
  });
});

describe("fixWpRocketCommand (--ssh fallback)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  it("remediates over SSH and verifies recovery", async () => {
    const runner = new FakeSshRunner();
    const results = await fixWpRocketCommand(makeClient(), "bravosite", {
      ssh: true,
      runner,
      fetch: okFetch,
    });

    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.verifiedStatus).toBe(200);
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.command).toContain("wp plugin deactivate wp-rocket");
    expect(runner.calls[0]?.command).toContain("advanced-cache.php");
  });

  it("reports failure when the ssh marker is missing", async () => {
    const runner = new FakeSshRunner({ code: 1, stdout: "boom", stderr: "wp: command not found" });
    const results = await fixWpRocketCommand(makeClient(), "bravosite", {
      ssh: true,
      runner,
      fetch: okFetch,
    });
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.action).toContain("failed");
  });
});
