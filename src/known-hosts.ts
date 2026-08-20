import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Trust-on-first-use (TOFU) SSH host-key store.
 *
 * Kinsta's API hands out a *password* for each site, so an unverified SSH
 * connection lets a network MITM capture that password (and inject commands
 * during `fix`). We pin each host key on first connect and refuse to connect
 * if a previously-seen key ever changes.
 */

/** OpenSSH-style SHA256 fingerprint, e.g. `SHA256:abc123…` (base64, no padding). */
export function fingerprint(key: Buffer): string {
  const digest = createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
  return `SHA256:${digest}`;
}

export interface KnownHostsStore {
  get(hostId: string): string | undefined;
  set(hostId: string, fp: string): void;
}

export type HostKeyStatus = "trusted-new" | "match" | "mismatch";

export interface HostKeyDecision {
  accept: boolean;
  status: HostKeyStatus;
  fingerprint: string;
  /** The previously-pinned fingerprint, present only on a mismatch. */
  expected?: string;
}

/**
 * Pure TOFU decision:
 *  - unknown host  -> pin it and accept (trusted-new)
 *  - same key      -> accept (match)
 *  - changed key   -> reject (mismatch, possible MITM)
 */
export function decideHostKey(
  store: KnownHostsStore,
  hostId: string,
  key: Buffer,
): HostKeyDecision {
  const fp = fingerprint(key);
  const known = store.get(hostId);
  if (known === undefined) {
    store.set(hostId, fp);
    return { accept: true, status: "trusted-new", fingerprint: fp };
  }
  if (known === fp) {
    return { accept: true, status: "match", fingerprint: fp };
  }
  return { accept: false, status: "mismatch", fingerprint: fp, expected: known };
}

/** In-memory store, handy for tests and as the base for the file-backed store. */
export class MemoryKnownHostsStore implements KnownHostsStore {
  protected readonly entries: Map<string, string>;

  constructor(initial?: Record<string, string>) {
    this.entries = new Map(Object.entries(initial ?? {}));
  }

  get(hostId: string): string | undefined {
    return this.entries.get(hostId);
  }

  set(hostId: string, fp: string): void {
    this.entries.set(hostId, fp);
  }
}

export function defaultKnownHostsPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.KINSTA_KNOWN_HOSTS?.trim()) return env.KINSTA_KNOWN_HOSTS.trim();
  const base = env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(base, "kinsta", "known_hosts.json");
}

/** JSON file-backed store persisted at {@link defaultKnownHostsPath}. */
export class FileKnownHostsStore extends MemoryKnownHostsStore {
  constructor(private readonly path: string = defaultKnownHostsPath()) {
    super(FileKnownHostsStore.load(path));
  }

  private static load(path: string): Record<string, string> {
    try {
      const raw = readFileSync(path, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as Record<string, string>;
    } catch {
      // Missing or unreadable file -> start empty (first-use).
    }
    return {};
  }

  override set(hostId: string, fp: string): void {
    super.set(hostId, fp);
    const obj: Record<string, string> = {};
    for (const [k, v] of this.entries) obj[k] = v;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(obj, null, 2)}\n`, { mode: 0o600 });
  }
}
