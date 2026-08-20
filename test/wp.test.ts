import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KinstaClient } from "../src/api.ts";
import { wpCliCommand } from "../src/commands/wp.ts";
import { WpCommandError } from "../src/wpcli.ts";
import runWpCli from "./fixtures/run-wp-cli.json";
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

describe("wpCliCommand", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("resolves the site and queues the command", async () => {
    let body: unknown;
    server.use(
      http.post(`${BASE}/sites/environments/:envId/run-wp-cli-command`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(runWpCli, { status: 202 });
      }),
    );
    await wpCliCommand(makeClient(), "bravosite", "wp core version");
    expect(body).toEqual({ wp_command: "wp core version" });
  });

  it("rejects an invalid command before calling the API", async () => {
    await expect(wpCliCommand(makeClient(), "bravosite", "rm -rf /")).rejects.toBeInstanceOf(
      WpCommandError,
    );
  });

  it("polls to completion with --wait", async () => {
    await wpCliCommand(makeClient(), "bravosite", "wp core version", { wait: true });
    // No throw = success; operation handler returns 200.
  });

  it("emits JSON with --json", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await wpCliCommand(makeClient(), "bravosite", "wp core version", { json: true, wait: true });
    const output = log.mock.calls.at(-1)?.[0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.command).toBe("wp core version");
    expect(parsed.operation_id).toBe(runWpCli.operation_id);
    expect(parsed.result.status).toBe(200);
  });
});
