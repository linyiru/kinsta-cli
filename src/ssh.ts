import { Client } from "ssh2";

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

function connect(target: SshTarget): Promise<Client> {
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
        // Kinsta containers share IPs on different ports; skip host-key pinning.
        // (ssh2 does not verify host keys unless a hostVerifier is supplied.)
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
