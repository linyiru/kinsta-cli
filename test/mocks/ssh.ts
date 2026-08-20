import type { SshResult, SshRunner, SshTarget } from "../../src/ssh.ts";

export interface SshCall {
  target: SshTarget;
  command: string;
}

/** In-memory SshRunner for tests; records calls and returns a canned result. */
export class FakeSshRunner implements SshRunner {
  public readonly calls: SshCall[] = [];

  constructor(
    private readonly result: SshResult = {
      code: 0,
      stdout:
        "Plugin 'wp-rocket' deactivated.\nSuccess: Deactivated 1 of 1 plugins.\nKINSTA_FIX_DONE\n",
      stderr: "",
    },
  ) {}

  run(target: SshTarget, command: string): Promise<SshResult> {
    this.calls.push({ target, command });
    return Promise.resolve(this.result);
  }

  shell(target: SshTarget): Promise<number> {
    this.calls.push({ target, command: "<shell>" });
    return Promise.resolve(0);
  }
}
