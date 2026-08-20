import { describe, expect, it } from "vitest";
import { classifyHttpStatus, diagnoseLogs, parseFatal } from "../src/analyze.ts";
import logsClean from "./fixtures/logs-clean.json";
import logsJetPopup from "./fixtures/logs-jet-popup.json";
import logsWpRocket from "./fixtures/logs-wp-rocket.json";

function toLines(fixture: { environment: { container_info: { logs: string } } }): string[] {
  return fixture.environment.container_info.logs.split("\n").filter((l) => l.trim().length > 0);
}

describe("classifyHttpStatus", () => {
  it.each([
    [200, "ok"],
    [301, "ok"],
    [399, "ok"],
    [403, "forbidden"],
    [404, "other"],
    [500, "server_error"],
    [502, "server_error"],
    [0, "unreachable"],
  ])("maps %i to %s", (code, expected) => {
    expect(classifyHttpStatus(code)).toBe(expected);
  });
});

describe("parseFatal", () => {
  it("extracts file, line and plugin from a fatal", () => {
    const line =
      'FastCGI sent in stderr: "PHP message: PHP Fatal error:  Uncaught TypeError: substr(): x in /www/x/public/wp-content/plugins/wp-rocket/inc/ThirdParty/Plugins/CDN/Cloudflare.php:496';
    const fatal = parseFatal(line);
    expect(fatal?.plugin).toBe("wp-rocket");
    expect(fatal?.file).toContain("Cloudflare.php");
    expect(fatal?.line).toBe(496);
  });

  it("returns undefined for non-fatal lines", () => {
    expect(parseFatal("PHP Warning: something")).toBeUndefined();
  });
});

describe("diagnoseLogs", () => {
  it("identifies the wp-rocket PHP 8 fatal", () => {
    const d = diagnoseLogs(toLines(logsWpRocket));
    expect(d.issue).toBe("wp-rocket-php8");
    expect(d.targetPlugin).toBe("wp-rocket");
    expect(d.fatal?.line).toBe(496);
  });

  it("identifies the jet-popup null fatal", () => {
    const d = diagnoseLogs(toLines(logsJetPopup));
    expect(d.issue).toBe("jet-popup-null");
    expect(d.targetPlugin).toBe("jet-popup");
  });

  it("reports healthy when there is no fatal", () => {
    const d = diagnoseLogs(toLines(logsClean));
    expect(d.issue).toBe("none");
    expect(d.fatal).toBeUndefined();
  });

  it("falls back to unknown-fatal for unrecognized plugins", () => {
    const d = diagnoseLogs([
      "PHP Fatal error:  Uncaught Error: boom in /www/x/public/wp-content/plugins/some-plugin/foo.php:10",
    ]);
    expect(d.issue).toBe("unknown-fatal");
    expect(d.fatal?.plugin).toBe("some-plugin");
  });
});
