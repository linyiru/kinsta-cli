import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  decideHostKey,
  defaultKnownHostsPath,
  FileKnownHostsStore,
  fingerprint,
  MemoryKnownHostsStore,
} from "../src/known-hosts.ts";

const keyA = Buffer.from("host-key-alpha");
const keyB = Buffer.from("host-key-bravo");

describe("fingerprint", () => {
  it("produces a stable OpenSSH-style SHA256 fingerprint with no padding", () => {
    const fp = fingerprint(keyA);
    expect(fp).toMatch(/^SHA256:[A-Za-z0-9+/]+$/);
    expect(fp.endsWith("=")).toBe(false);
    expect(fingerprint(keyA)).toBe(fp);
    expect(fingerprint(keyB)).not.toBe(fp);
  });
});

describe("decideHostKey (TOFU)", () => {
  it("pins an unknown host on first use and accepts it", () => {
    const store = new MemoryKnownHostsStore();
    const decision = decideHostKey(store, "1.2.3.4:22", keyA);
    expect(decision.status).toBe("trusted-new");
    expect(decision.accept).toBe(true);
    expect(store.get("1.2.3.4:22")).toBe(fingerprint(keyA));
  });

  it("accepts a matching pinned key", () => {
    const store = new MemoryKnownHostsStore({ "1.2.3.4:22": fingerprint(keyA) });
    const decision = decideHostKey(store, "1.2.3.4:22", keyA);
    expect(decision.status).toBe("match");
    expect(decision.accept).toBe(true);
  });

  it("rejects a changed key as a possible MITM", () => {
    const store = new MemoryKnownHostsStore({ "1.2.3.4:22": fingerprint(keyA) });
    const decision = decideHostKey(store, "1.2.3.4:22", keyB);
    expect(decision.status).toBe("mismatch");
    expect(decision.accept).toBe(false);
    expect(decision.expected).toBe(fingerprint(keyA));
    // A rejected key must never overwrite the pinned one.
    expect(store.get("1.2.3.4:22")).toBe(fingerprint(keyA));
  });

  it("keys by host:port so shared IPs on different ports are independent", () => {
    const store = new MemoryKnownHostsStore();
    decideHostKey(store, "1.2.3.4:1001", keyA);
    const other = decideHostKey(store, "1.2.3.4:1002", keyB);
    expect(other.status).toBe("trusted-new");
    expect(store.get("1.2.3.4:1001")).toBe(fingerprint(keyA));
    expect(store.get("1.2.3.4:1002")).toBe(fingerprint(keyB));
  });
});

describe("defaultKnownHostsPath", () => {
  it("honours KINSTA_KNOWN_HOSTS override", () => {
    expect(defaultKnownHostsPath({ KINSTA_KNOWN_HOSTS: "/custom/hosts.json" })).toBe(
      "/custom/hosts.json",
    );
  });

  it("falls back to XDG_CONFIG_HOME", () => {
    expect(defaultKnownHostsPath({ XDG_CONFIG_HOME: "/xdg" })).toBe("/xdg/kinsta/known_hosts.json");
  });
});

describe("FileKnownHostsStore", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("persists pinned keys to disk with 0600 permissions and reloads them", () => {
    dir = mkdtempSync(join(tmpdir(), "kinsta-hosts-"));
    const path = join(dir, "nested", "known_hosts.json");

    const store = new FileKnownHostsStore(path);
    store.set("1.2.3.4:22", fingerprint(keyA));

    const onDisk: Record<string, string> = JSON.parse(readFileSync(path, "utf8"));
    expect(onDisk["1.2.3.4:22"]).toBe(fingerprint(keyA));
    expect(statSync(path).mode & 0o777).toBe(0o600);

    const reloaded = new FileKnownHostsStore(path);
    expect(reloaded.get("1.2.3.4:22")).toBe(fingerprint(keyA));
  });

  it("starts empty when the file is missing or malformed", () => {
    dir = mkdtempSync(join(tmpdir(), "kinsta-hosts-"));
    const missing = new FileKnownHostsStore(join(dir, "does-not-exist.json"));
    expect(missing.get("anything:22")).toBeUndefined();
  });
});
