import { Client } from "ssh2";
import { decideHostKey, FileKnownHostsStore, type KnownHostsStore } from "./known-hosts.ts";

export interface SshTarget {
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface SshResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Abstraction over SSH so commands can be unit-tested with a fake runner
 * (the Kinsta API cannot deactivate plugins, so remediation needs WP-CLI over SSH).
 */
export interface SshRunner {
  run(target: SshTarget, command: string): Promise<SshResult>;
  shell(target: SshTarget): Promise<number>;
}

const READY_TIMEOUT_MS = 30_000;

/**
 * Build a ssh2 `hostVerifier` that pins host keys on first use (TOFU) and
 * refuses to connect if a pinned key ever changes (possible MITM).
 */
function makeHostVerifier(
  target: SshTarget,
  store: KnownHostsStore,
  onWarn: (message: string) => void,
): (key: Buffer) => boolean {
  const hostId = `${target.host}:${target.port}`;
  return (key: Buffer): boolean => {
    const decision = decideHostKey(store, hostId, key);
    if (decision.status === "trusted-new") {
      onWarn(
        `Pinned new SSH host key for ${hostId} (${decision.fingerprint}). ` +
          `It will be verified on future connections.`,
      );
    } else if (decision.status === "mismatch") {
      onWarn(
        `SSH host key mismatch for ${hostId}! ` +
          `Expected ${decision.expected}, got ${decision.fingerprint}. ` +
          `Refusing to connect (possible man-in-the-middle). ` +
          `If this change is expected, remove the entry from the known_hosts file and retry.`,
      );
    }
    return decision.accept;
  };
}

const defaultStore: KnownHostsStore = new FileKnownHostsStore();

function warn(message: string): void {
  process.stderr.write(`kinsta: ${message}\n`);
}

function connect(target: SshTarget, store: KnownHostsStore = defaultStore): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client
      .on("ready", () => resolve(client))
      .on("error", reject)
      .connect({
        host: target.host,
        port: target.port,
        username: target.user,
        password: target.password,
        readyTimeout: READY_TIMEOUT_MS,
        // Kinsta containers share IPs on different ports, so we key the pinned
        // host key on host:port and trust-on-first-use rather than a global
        // known_hosts. Rejecting a changed key blocks MITM password capture.
        hostVerifier: makeHostVerifier(target, store, warn),
      });
  });
}

export class Ssh2Runner implements SshRunner {
  async run(target: SshTarget, command: string): Promise<SshResult> {
    const client = await connect(target);
    try {
      return await new Promise<SshResult>((resolve, reject) => {
        client.exec(command, (err, stream) => {
          if (err) {
            reject(err);
            return;
          }
          let stdout = "";
          let stderr = "";
          stream
            .on("close", (code: number | null) => resolve({ code, stdout, stderr }))
            .on("data", (chunk: Buffer) => {
              stdout += chunk.toString("utf8");
            });
          stream.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf8");
          });
        });
      });
    } finally {
      client.end();
    }
  }

  async shell(target: SshTarget): Promise<number> {
    const client = await connect(target);
    return new Promise<number>((resolve, reject) => {
      client.shell({ term: process.env.TERM ?? "xterm-256color" }, (err, stream) => {
        if (err) {
          client.end();
          reject(err);
          return;
        }
        const stdin = process.stdin;
        const wasRaw = stdin.isTTY ? stdin.isRaw : false;
        if (stdin.isTTY) stdin.setRawMode(true);
        stdin.resume();
        stdin.pipe(stream);
        stream.pipe(process.stdout);
        stream.stderr.pipe(process.stderr);

        const cleanup = () => {
          if (stdin.isTTY) stdin.setRawMode(wasRaw);
          stdin.unpipe(stream);
          stdin.pause();
        };

        stream.on("close", (code: number | null) => {
          cleanup();
          client.end();
          resolve(code ?? 0);
        });
        stream.on("error", (streamErr: Error) => {
          cleanup();
          client.end();
          reject(streamErr);
        });
      });
    });
  }
}
